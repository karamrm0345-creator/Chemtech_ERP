import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, withTx, type Tx } from "../db";
import { can, requirePerm, requireAny, type Ctx } from "../context";
import { audit } from "../audit";
import { nextNumber } from "../numbering";
import { AppError, NotFoundError } from "../errors";
import { assertCanApprove, recordApproval } from "../approvals";
import {
  commercialLine, decimalStr, nonNegDecimal, optDate, optId, optStr, posDecimal, reqStr,
} from "@/lib/validation";
import { D, ZERO, calcLine, calcTotals, round2, round4, type Dec } from "@/lib/decimal";
import { assertStatus, getSettings, lockRow, orderBy, paging, rateFor, toBase, type ListArgs } from "./common";
import {
  assertAvailable, allocateLots, getOrCreateBatch, isStockItem, lockItems, onHand, onOrderQty, parseSerials, postStock, reservedQty,
} from "./inventory-engine";

async function itemMap(tx: Tx, ids: (string | null | undefined)[]) {
  const list = await tx.item.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, include: { uom: true } });
  return new Map(list.map((i) => [i.id, i]));
}

async function assertSupplier(tx: Tx, id: string) {
  const s = await tx.supplier.findUnique({ where: { id } });
  if (!s) throw new NotFoundError("Supplier");
  if (!s.active) throw new AppError(`Supplier ${s.code} is inactive.`);
  if (s.prequalStatus === "REJECTED") throw new AppError(`Supplier ${s.code} failed prequalification.`);
  return s;
}

// ───────── Purchase requests ─────────

export const prSchema = z.object({
  date: optDate,
  department: optStr(80),
  costCenter: optStr(80),
  requiredDate: optDate,
  justification: reqStr(2000),
  lines: z.array(z.object({
    itemId: optId, description: reqStr(500), quantity: posDecimal, uom: optStr(20),
    estimatedUnitPrice: nonNegDecimal.optional().default("0"), requiredDate: optDate,
  })).min(1, "Add at least one line"),
});

export async function savePurchaseRequest(ctx: Ctx, id: string | null, raw: unknown) {
  requirePerm(ctx, "purchase.request.manage");
  const d = prSchema.parse(raw);
  return withTx(async (tx) => {
    const items = await itemMap(tx, d.lines.map((l) => l.itemId));
    const lines = d.lines.map((l, i) => ({
      lineNo: i + 1, itemId: l.itemId ?? null, description: l.description, quantity: D(l.quantity),
      uom: l.uom ?? (l.itemId ? items.get(l.itemId)?.uom.code : null) ?? null, estimatedUnitPrice: D(l.estimatedUnitPrice),
      requiredDate: l.requiredDate ?? d.requiredDate ?? null,
    }));
    const estimatedTotal = round2(lines.reduce((s, l) => s.add(l.quantity.mul(l.estimatedUnitPrice)), ZERO));
    const header = { department: d.department, costCenter: d.costCenter, requiredDate: d.requiredDate, justification: d.justification, estimatedTotal, ...(d.date ? { date: d.date } : {}) };
    if (id) {
      await lockRow(tx, "PurchaseRequest", id);
      const pr = await tx.purchaseRequest.findUniqueOrThrow({ where: { id } });
      assertStatus(pr.status, ["DRAFT"], "edit request");
      await tx.purchaseRequestLine.deleteMany({ where: { requestId: id } });
      const upd = await tx.purchaseRequest.update({ where: { id }, data: { ...header, lines: { create: lines } } });
      await audit(tx, ctx, { action: "UPDATE", entity: "PurchaseRequest", entityId: id, summary: `Updated ${pr.number}` });
      return upd;
    }
    const number = await nextNumber(tx, "PURCHASE_REQUEST");
    const pr = await tx.purchaseRequest.create({ data: { ...header, number, requestedById: ctx.userId, lines: { create: lines } } });
    await audit(tx, ctx, { action: "CREATE", entity: "PurchaseRequest", entityId: pr.id, summary: `Created purchase request ${number}` });
    return pr;
  });
}

export async function purchaseRequestAction(ctx: Ctx, id: string, action: "submit" | "approve" | "reject" | "cancel", comment?: string) {
  return withTx(async (tx) => {
    await lockRow(tx, "PurchaseRequest", id);
    const pr = await tx.purchaseRequest.findUniqueOrThrow({ where: { id } });
    const settings = await getSettings(tx);
    let status: Prisma.PurchaseRequestUpdateInput["status"];
    const extra: Prisma.PurchaseRequestUpdateInput = {};
    switch (action) {
      case "submit":
        requirePerm(ctx, "purchase.request.manage"); assertStatus(pr.status, ["DRAFT"], "submit");
        status = settings.requirePrApproval ? "SUBMITTED" : "APPROVED";
        break;
      case "approve":
        assertStatus(pr.status, ["SUBMITTED"], "approve");
        await assertCanApprove(tx, ctx, { docType: "PURCHASE_REQUEST", permission: "purchase.request.approve", createdById: pr.requestedById, amountBase: D(pr.estimatedTotal) });
        status = "APPROVED"; extra.approvedById = ctx.userId; extra.approvedAt = new Date();
        break;
      case "reject":
        requirePerm(ctx, "purchase.request.approve"); assertStatus(pr.status, ["SUBMITTED"], "reject");
        if (!comment) throw new AppError("Please give a rejection reason.");
        status = "REJECTED";
        break;
      case "cancel":
        requireAny(ctx, "purchase.request.manage", "purchase.request.approve"); assertStatus(pr.status, ["DRAFT", "SUBMITTED", "APPROVED"], "cancel");
        if ((await tx.purchaseOrder.count({ where: { purchaseRequestId: id, status: { notIn: ["CANCELLED", "REJECTED"] } } })) > 0) {
          throw new AppError("Purchase orders exist for this request.");
        }
        status = "CANCELLED";
        break;
    }
    await tx.purchaseRequest.update({ where: { id }, data: { status, ...extra } });
    await recordApproval(tx, ctx, { docType: "PURCHASE_REQUEST", docId: id, docNo: pr.number, action: action.toUpperCase(), comment, amount: pr.estimatedTotal });
    await audit(tx, ctx, { action: action.toUpperCase(), entity: "PurchaseRequest", entityId: id, summary: `${pr.number}: ${pr.status} → ${status}${comment ? ` (${comment})` : ""}` });
  });
}

/** Example C: low-stock items → suggested purchase request (draft). */
export async function lowStockSuggestions(tx: Tx) {
  const items = await tx.item.findMany({
    where: { active: true, minStockLevel: { gt: 0 }, inventoryClass: { not: "NON_STOCK" }, itemType: { not: "SERVICE" } },
    include: { uom: true, preferredSupplier: true },
  });
  const out = [];
  for (const it of items) {
    const [oh, res, oo] = await Promise.all([onHand(tx, it.id), reservedQty(tx, it.id), onOrderQty(tx, it.id)]);
    if (oh.gt(it.minStockLevel)) continue;
    // Reorder point: when projected stock (free + on order) is at/below the
    // minimum, order the reorder quantity — or the gap, whichever is larger.
    const projected = oh.sub(res).add(oo);
    const gap = D(it.minStockLevel).sub(projected);
    const suggested = projected.lte(it.minStockLevel) ? (D(it.reorderQty).gt(gap) ? D(it.reorderQty) : gap) : ZERO;
    out.push({ item: it, onHand: oh, reserved: res, onOrder: oo, shortage: gap.gt(0) ? gap : ZERO, suggested });
  }
  return out;
}

export async function purchaseRequestFromLowStock(ctx: Ctx, itemIds: string[]) {
  requirePerm(ctx, "purchase.request.manage");
  return withTx(async (tx) => {
    const sugg = (await lowStockSuggestions(tx)).filter((s) => itemIds.includes(s.item.id) && s.suggested.gt(0));
    if (!sugg.length) throw new AppError("None of the selected items needs replenishment (on-order stock already covers them).");
    const number = await nextNumber(tx, "PURCHASE_REQUEST");
    const lines = sugg.map((s, i) => ({
      lineNo: i + 1, itemId: s.item.id, description: `${s.item.code} — ${s.item.name}`, quantity: s.suggested, uom: s.item.uom.code,
      estimatedUnitPrice: s.item.purchasePrice,
    }));
    const pr = await tx.purchaseRequest.create({
      data: {
        number, requestedById: ctx.userId, source: "LOW_STOCK", justification: "Replenishment of items at or below minimum stock level",
        estimatedTotal: round2(lines.reduce((t, l) => t.add(D(l.quantity).mul(D(l.estimatedUnitPrice))), ZERO)), lines: { create: lines },
      },
    });
    await audit(tx, ctx, { action: "CREATE", entity: "PurchaseRequest", entityId: pr.id, summary: `Created ${number} from low-stock alert (${lines.length} items)` });
    return pr;
  });
}

// ───────── RFQs & supplier quotations ─────────

export const rfqSchema = z.object({
  title: reqStr(200), purchaseRequestId: optId, dueDate: optDate, notes: optStr(2000),
  supplierIds: z.array(z.string()).min(1, "Select at least one supplier"),
  lines: z.array(z.object({ prLineId: optId, itemId: optId, description: reqStr(500), quantity: posDecimal, uom: optStr(20) })).min(1),
});

export async function createRfq(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "purchase.rfq.manage");
  const d = rfqSchema.parse(raw);
  return withTx(async (tx) => {
    if (d.purchaseRequestId) {
      const pr = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: d.purchaseRequestId } });
      assertStatus(pr.status, ["APPROVED", "PARTIALLY_ORDERED"], "create an RFQ from this request");
    }
    for (const s of d.supplierIds) await assertSupplier(tx, s);
    const number = await nextNumber(tx, "RFQ");
    const rfq = await tx.rfq.create({
      data: {
        number, title: d.title, purchaseRequestId: d.purchaseRequestId, dueDate: d.dueDate, notes: d.notes, createdById: ctx.userId,
        lines: { create: d.lines.map((l, i) => ({ ...l, lineNo: i + 1, quantity: D(l.quantity) })) },
        suppliers: { create: [...new Set(d.supplierIds)].map((supplierId) => ({ supplierId })) },
      },
    });
    await audit(tx, ctx, { action: "CREATE", entity: "Rfq", entityId: rfq.id, summary: `Created RFQ ${number}` });
    return rfq;
  });
}

export async function rfqAction(ctx: Ctx, id: string, action: "send" | "close" | "cancel") {
  requirePerm(ctx, "purchase.rfq.manage");
  return withTx(async (tx) => {
    await lockRow(tx, "Rfq", id);
    const r = await tx.rfq.findUniqueOrThrow({ where: { id } });
    const map = { send: [["DRAFT"], "SENT"], close: [["SENT"], "CLOSED"], cancel: [["DRAFT", "SENT"], "CANCELLED"] } as const;
    const [from, to] = map[action];
    assertStatus(r.status, [...from], action);
    await tx.rfq.update({ where: { id }, data: { status: to } });
    await audit(tx, ctx, { action: action.toUpperCase(), entity: "Rfq", entityId: id, summary: `${r.number}: ${r.status} → ${to}` });
  });
}

export const supplierQuoteSchema = z.object({
  supplierId: reqStr(40), rfqId: optId, supplierRef: optStr(100), date: optDate, validUntil: optDate,
  currency: reqStr(3).default("QAR"), deliveryDays: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(0).max(3650).optional()),
  paymentTerms: optStr(200), deliveryTerms: optStr(200),
  technicalCompliance: z.enum(["NOT_EVALUATED", "COMPLIANT", "PARTIAL", "NON_COMPLIANT"]).default("NOT_EVALUATED"),
  notes: optStr(2000),
  lines: z.array(commercialLine.extend({ rfqLineId: optId })).min(1),
  scores: z.array(z.object({ criterionId: z.string(), score: z.coerce.number().min(0).max(10) })).default([]),
});

export async function saveSupplierQuotation(ctx: Ctx, id: string | null, raw: unknown) {
  requirePerm(ctx, "purchase.rfq.manage");
  const d = supplierQuoteSchema.parse(raw);
  return withTx(async (tx) => {
    await assertSupplier(tx, d.supplierId);
    if (d.rfqId) {
      const rfq = await tx.rfq.findUniqueOrThrow({ where: { id: d.rfqId }, include: { suppliers: true } });
      if (!rfq.suppliers.some((s) => s.supplierId === d.supplierId)) throw new AppError("This supplier was not invited to the RFQ.");
      assertStatus(rfq.status, ["DRAFT", "SENT", "CLOSED"], "record offers for this RFQ");
    }
    const items = await itemMap(tx, d.lines.map((l) => l.itemId));
    const lines = d.lines.map((l, i) => {
      const c = calcLine(l);
      return {
        lineNo: i + 1, rfqLineId: l.rfqLineId ?? null, itemId: l.itemId ?? null, description: l.description, quantity: D(l.quantity),
        uom: l.uom ?? (l.itemId ? items.get(l.itemId)?.uom.code : null) ?? null, unitPrice: D(l.unitPrice), discountPct: D(l.discountPct),
        taxRate: D(l.taxRate), lineTotal: c.lineTotal, taxAmount: c.taxAmount,
      };
    });
    const t = calcTotals(d.lines);
    const rate = await rateFor(tx, d.currency);
    const header = {
      supplierId: d.supplierId, rfqId: d.rfqId ?? null, supplierRef: d.supplierRef, validUntil: d.validUntil, currency: d.currency, exchangeRate: rate,
      deliveryDays: d.deliveryDays, paymentTerms: d.paymentTerms, deliveryTerms: d.deliveryTerms, technicalCompliance: d.technicalCompliance,
      notes: d.notes, subtotal: t.subtotal.sub(t.discountTotal), taxTotal: t.taxTotal, total: t.total, ...(d.date ? { date: d.date } : {}),
    };
    let sq;
    if (id) {
      await lockRow(tx, "SupplierQuotation", id);
      const cur = await tx.supplierQuotation.findUniqueOrThrow({ where: { id } });
      assertStatus(cur.status, ["RECEIVED"], "edit supplier quotation");
      await tx.supplierQuotationLine.deleteMany({ where: { quotationId: id } });
      await tx.supplierQuotationScore.deleteMany({ where: { quotationId: id } });
      sq = await tx.supplierQuotation.update({ where: { id }, data: { ...header, lines: { create: lines } } });
    } else {
      const number = await nextNumber(tx, "SUPPLIER_QUOTATION");
      sq = await tx.supplierQuotation.create({ data: { ...header, number, createdById: ctx.userId, lines: { create: lines } } });
    }
    if (d.scores.length) await tx.supplierQuotationScore.createMany({ data: d.scores.map((s) => ({ quotationId: sq.id, criterionId: s.criterionId, score: s.score })) });
    await audit(tx, ctx, { action: id ? "UPDATE" : "CREATE", entity: "SupplierQuotation", entityId: sq.id, summary: `${id ? "Updated" : "Recorded"} supplier quotation ${sq.number}` });
    return sq;
  });
}

/** Comparison matrix for an RFQ: price (base currency), delivery, terms, compliance and weighted score. */
export async function rfqComparison(rfqId: string) {
  const rfq = await prisma.rfq.findUniqueOrThrow({
    where: { id: rfqId },
    include: {
      lines: { orderBy: { lineNo: "asc" } },
      quotations: { include: { supplier: true, lines: true, scores: true } },
    },
  });
  const criteria = await prisma.evaluationCriterion.findMany({ where: { active: true }, orderBy: { sort: "asc" } });
  const totalWeight = criteria.reduce((s, c) => s + Number(c.weight), 0) || 1;
  const quotes = rfq.quotations.map((q) => {
    const totalBase = toBase(q.total, D(q.exchangeRate));
    const weighted = criteria.reduce((s, c) => s + Number(q.scores.find((x) => x.criterionId === c.id)?.score ?? 0) * Number(c.weight), 0) / totalWeight;
    return { ...q, totalBase, weightedScore: Math.round(weighted * 100) / 100 };
  });
  const cheapest = quotes.filter((q) => q.technicalCompliance !== "NON_COMPLIANT").sort((a, b) => a.totalBase.cmp(b.totalBase))[0]?.id;
  const fastest = quotes.filter((q) => q.deliveryDays != null).sort((a, b) => a.deliveryDays! - b.deliveryDays!)[0]?.id;
  const best = [...quotes].sort((a, b) => b.weightedScore - a.weightedScore)[0]?.id;
  return { rfq, quotes, criteria, cheapest, fastest, best };
}

export async function selectSupplierQuotation(ctx: Ctx, quotationId: string, comment?: string) {
  requirePerm(ctx, "purchase.rfq.manage");
  return withTx(async (tx) => {
    await lockRow(tx, "SupplierQuotation", quotationId);
    const q = await tx.supplierQuotation.findUniqueOrThrow({ where: { id: quotationId } });
    assertStatus(q.status, ["RECEIVED"], "select");
    if (q.technicalCompliance === "NON_COMPLIANT") throw new AppError("A technically non-compliant offer cannot be selected.");
    await tx.supplierQuotation.update({ where: { id: quotationId }, data: { status: "SELECTED" } });
    if (q.rfqId) {
      await tx.supplierQuotation.updateMany({ where: { rfqId: q.rfqId, id: { not: quotationId }, status: "RECEIVED" }, data: { status: "REJECTED" } });
      await tx.rfq.update({ where: { id: q.rfqId }, data: { status: "AWARDED" } });
    }
    await recordApproval(tx, ctx, { docType: "SUPPLIER_QUOTATION", docId: q.id, docNo: q.number, action: "SELECT", comment, amount: q.total });
    await audit(tx, ctx, { action: "SELECT", entity: "SupplierQuotation", entityId: q.id, summary: `Selected supplier quotation ${q.number}${comment ? `: ${comment}` : ""}` });
  });
}

// ───────── Purchase orders ─────────

export const poSchema = z.object({
  supplierId: reqStr(40),
  supplierQuotationId: optId,
  purchaseRequestId: optId,
  supplierQuoteRef: optStr(100),
  date: optDate,
  expectedDate: optDate,
  warehouseId: reqStr(40),
  currency: reqStr(3).default("QAR"),
  paymentTerms: optStr(200),
  deliveryTerms: optStr(200),
  allowPartial: z.boolean().default(true),
  freight: nonNegDecimal.default("0"),
  otherCharges: nonNegDecimal.default("0"),
  notes: optStr(4000),
  lines: z.array(commercialLine.extend({ prLineId: optId })).min(1, "Add at least one line"),
});

export async function savePurchaseOrder(ctx: Ctx, id: string | null, raw: unknown) {
  requirePerm(ctx, "purchase.order.manage");
  const d = poSchema.parse(raw);
  return withTx(async (tx) => {
    const supplier = await assertSupplier(tx, d.supplierId);
    const settings = await getSettings(tx);
    if (settings.requireRfq && !d.supplierQuotationId) throw new AppError("Company policy requires a selected supplier quotation for every purchase order.");
    if (settings.requirePrForPo && !d.purchaseRequestId) throw new AppError("Company policy requires an approved purchase request for every purchase order.");
    if (d.supplierQuotationId) {
      const sq = await tx.supplierQuotation.findUniqueOrThrow({ where: { id: d.supplierQuotationId } });
      if (sq.supplierId !== supplier.id) throw new AppError("The supplier quotation belongs to another supplier.");
      if (settings.requireRfq && sq.status !== "SELECTED") throw new AppError("The supplier quotation has not been selected.");
    }
    if (d.purchaseRequestId) {
      const pr = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: d.purchaseRequestId } });
      assertStatus(pr.status, ["APPROVED", "PARTIALLY_ORDERED"], "order against this purchase request");
    }
    const items = await itemMap(tx, d.lines.map((l) => l.itemId));
    const lines = d.lines.map((l, i) => {
      const it = l.itemId ? items.get(l.itemId) : undefined;
      if (l.itemId && !it) throw new AppError(`Line ${i + 1}: item not found.`);
      const c = calcLine(l);
      return {
        lineNo: i + 1, prLineId: l.prLineId ?? null, itemId: l.itemId ?? null, description: l.description, quantity: D(l.quantity),
        uom: l.uom ?? it?.uom.code ?? null, unitPrice: D(l.unitPrice), discountPct: D(l.discountPct), taxRate: D(l.taxRate),
        lineTotal: c.lineTotal, taxAmount: c.taxAmount,
      };
    });
    const t = calcTotals(d.lines, D(d.freight).add(D(d.otherCharges)));
    const rate = await rateFor(tx, d.currency);
    const header = {
      supplierId: d.supplierId, supplierQuotationId: d.supplierQuotationId ?? null, purchaseRequestId: d.purchaseRequestId ?? null,
      supplierQuoteRef: d.supplierQuoteRef, expectedDate: d.expectedDate, warehouseId: d.warehouseId, currency: d.currency, exchangeRate: rate,
      paymentTerms: d.paymentTerms ?? supplier.paymentTerms, deliveryTerms: d.deliveryTerms, allowPartial: d.allowPartial,
      freight: D(d.freight), otherCharges: D(d.otherCharges), notes: d.notes, ...t, ...(d.date ? { date: d.date } : {}),
    };
    if (id) {
      await lockRow(tx, "PurchaseOrder", id);
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
      assertStatus(po.status, ["DRAFT", "REJECTED"], "edit purchase order");
      await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
      const upd = await tx.purchaseOrder.update({ where: { id }, data: { ...header, status: "DRAFT", lines: { create: lines } } });
      await audit(tx, ctx, { action: "UPDATE", entity: "PurchaseOrder", entityId: id, summary: `Updated ${po.number}`, after: { ...header, lines } });
      return upd;
    }
    const number = await nextNumber(tx, "PURCHASE_ORDER");
    const po = await tx.purchaseOrder.create({ data: { ...header, number, createdById: ctx.userId, lines: { create: lines } } });
    await audit(tx, ctx, { action: "CREATE", entity: "PurchaseOrder", entityId: po.id, summary: `Created purchase order ${number}` });
    return po;
  });
}

async function refreshPrStatus(tx: Tx, prId: string | null) {
  if (!prId) return;
  const pr = await tx.purchaseRequest.findUnique({ where: { id: prId }, include: { lines: true } });
  if (!pr || !["APPROVED", "PARTIALLY_ORDERED", "ORDERED"].includes(pr.status)) return;
  const ordered = await tx.purchaseOrderLine.groupBy({
    by: ["prLineId"], where: { prLineId: { in: pr.lines.map((l) => l.id) }, order: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] } } },
    _sum: { quantity: true },
  });
  let any = false, all = true;
  for (const l of pr.lines) {
    const q = D(ordered.find((o) => o.prLineId === l.id)?._sum.quantity);
    await tx.purchaseRequestLine.update({ where: { id: l.id }, data: { orderedQty: q } });
    if (q.gt(0)) any = true;
    if (q.lt(D(l.quantity))) all = false;
  }
  await tx.purchaseRequest.update({ where: { id: prId }, data: { status: all ? "ORDERED" : any ? "PARTIALLY_ORDERED" : "APPROVED" } });
}

export async function purchaseOrderAction(ctx: Ctx, id: string, action: "submit" | "approve" | "reject" | "cancel" | "close", comment?: string) {
  return withTx(async (tx) => {
    await lockRow(tx, "PurchaseOrder", id);
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    let status: Prisma.PurchaseOrderUpdateInput["status"];
    const extra: Prisma.PurchaseOrderUpdateInput = {};
    switch (action) {
      case "submit":
        requirePerm(ctx, "purchase.order.manage"); assertStatus(po.status, ["DRAFT"], "submit"); status = "SUBMITTED"; break;
      case "approve":
        assertStatus(po.status, ["SUBMITTED"], "approve");
        await assertCanApprove(tx, ctx, { docType: "PURCHASE_ORDER", permission: "purchase.order.approve", createdById: po.createdById, amountBase: toBase(po.total, D(po.exchangeRate)) });
        status = "APPROVED"; extra.approvedById = ctx.userId; extra.approvedAt = new Date(); break;
      case "reject":
        requirePerm(ctx, "purchase.order.approve"); assertStatus(po.status, ["SUBMITTED"], "reject");
        if (!comment) throw new AppError("Please give a rejection reason."); status = "REJECTED"; break;
      case "cancel":
        requireAny(ctx, "purchase.order.manage", "purchase.order.approve");
        assertStatus(po.status, ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"], "cancel");
        if (po.lines.some((l) => D(l.receivedQty).gt(0))) throw new AppError("Goods were received: close the order instead.");
        if (await tx.goodsReceipt.count({ where: { purchaseOrderId: id, status: "DRAFT" } })) throw new AppError("Cancel draft goods receipts first.");
        status = "CANCELLED"; break;
      case "close":
        requirePerm(ctx, "purchase.order.approve"); assertStatus(po.status, ["APPROVED", "PARTIALLY_RECEIVED"], "close"); status = "CLOSED"; break;
    }
    await tx.purchaseOrder.update({ where: { id }, data: { status, ...extra } });
    await refreshPrStatus(tx, po.purchaseRequestId);
    await recordApproval(tx, ctx, { docType: "PURCHASE_ORDER", docId: id, docNo: po.number, action: action.toUpperCase(), comment, amount: po.total });
    await audit(tx, ctx, { action: action.toUpperCase(), entity: "PurchaseOrder", entityId: id, summary: `${po.number}: ${po.status} → ${status}${comment ? ` (${comment})` : ""}` });
  });
}

// ───────── Goods receipts ─────────

export const grnSchema = z.object({
  purchaseOrderId: reqStr(40),
  date: optDate,
  supplierDeliveryNote: optStr(100),
  notes: optStr(2000),
  lines: z.array(z.object({
    poLineId: reqStr(40),
    receivedQty: posDecimal,
    rejectedQty: nonNegDecimal.optional().default("0"),
    rejectionReason: optStr(500),
    batchNo: optStr(60),
    expiryDate: optDate,
    certificateNo: optStr(100),
    serialNos: optStr(4000),
    locationId: optId,
  })).min(1, "Add at least one line"),
}).superRefine((d, c) => d.lines.forEach((l, i) => {
  if (Number(l.rejectedQty) > Number(l.receivedQty)) c.addIssue({ code: "custom", path: ["lines", i, "rejectedQty"], message: "Rejected cannot exceed received" });
  if (Number(l.rejectedQty) > 0 && !l.rejectionReason) c.addIssue({ code: "custom", path: ["lines", i, "rejectionReason"], message: "Give a rejection reason" });
}));

function maxReceivable(ordered: Dec, netReceived: Dec, tolerancePct: Dec) {
  return ordered.mul(D(1).add(tolerancePct.div(100))).sub(netReceived);
}

export async function createGoodsReceipt(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "purchase.receipt.manage");
  const d = grnSchema.parse(raw);
  return withTx(async (tx) => {
    await lockRow(tx, "PurchaseOrder", d.purchaseOrderId);
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: d.purchaseOrderId }, include: { lines: true } });
    assertStatus(po.status, ["APPROVED", "PARTIALLY_RECEIVED"], "receive goods");
    const settings = await getSettings(tx);
    const items = await itemMap(tx, po.lines.map((l) => l.itemId));
    for (const l of d.lines) {
      const pol = po.lines.find((x) => x.id === l.poLineId);
      if (!pol) throw new AppError("Receipt line does not belong to this purchase order.");
      const accepted = D(l.receivedQty).sub(D(l.rejectedQty));
      const room = maxReceivable(D(pol.quantity), D(pol.receivedQty).sub(D(pol.returnedQty)), D(settings.grnTolerancePct));
      if (accepted.gt(room)) throw new AppError(`Line ${pol.lineNo}: accepted quantity ${accepted} exceeds the outstanding quantity (${room.lt(0) ? 0 : room}).`);
      const it = pol.itemId ? items.get(pol.itemId) : undefined;
      if (it && isStockItem(it) && accepted.gt(0)) {
        if (it.batchTracked && !l.batchNo) throw new AppError(`${it.code}: batch/lot number is required.`);
        if (it.expiryTracked && !l.expiryDate) throw new AppError(`${it.code}: expiry date is required.`);
        if (it.serialTracked && parseSerials(l.serialNos).length !== accepted.toNumber()) throw new AppError(`${it.code}: enter ${accepted} serial number(s).`);
      }
    }
    const number = await nextNumber(tx, "GOODS_RECEIPT");
    const grn = await tx.goodsReceipt.create({
      data: {
        number, purchaseOrderId: po.id, supplierId: po.supplierId, warehouseId: po.warehouseId, date: d.date ?? new Date(),
        supplierDeliveryNote: d.supplierDeliveryNote, notes: d.notes, createdById: ctx.userId,
        lines: { create: d.lines.map((l) => {
          const pol = po.lines.find((x) => x.id === l.poLineId)!;
          return {
            poLineId: pol.id, itemId: pol.itemId, description: pol.description, receivedQty: D(l.receivedQty), rejectedQty: D(l.rejectedQty),
            acceptedQty: D(l.receivedQty).sub(D(l.rejectedQty)), rejectionReason: l.rejectionReason, batchNo: l.batchNo, expiryDate: l.expiryDate,
            certificateNo: l.certificateNo, serialNos: l.serialNos, locationId: l.locationId,
          };
        }) },
      },
    });
    await audit(tx, ctx, { action: "CREATE", entity: "GoodsReceipt", entityId: grn.id, summary: `Created goods receipt ${number} for ${po.number}` });
    return grn;
  });
}

/**
 * Posts a GRN: increases stock exactly once at landed cost, updates PO
 * received/outstanding quantities and status, and logs rejections as
 * supplier nonconformities.
 */
export async function postGoodsReceipt(ctx: Ctx, grnId: string) {
  requirePerm(ctx, "purchase.receipt.post");
  return withTx(async (tx) => {
    await lockRow(tx, "GoodsReceipt", grnId);
    const grn = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: grnId }, include: { lines: true } });
    assertStatus(grn.status, ["DRAFT"], "post goods receipt");
    await lockRow(tx, "PurchaseOrder", grn.purchaseOrderId);
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: grn.purchaseOrderId }, include: { lines: true } });
    assertStatus(po.status, ["APPROVED", "PARTIALLY_RECEIVED"], "receive against this order");
    const settings = await getSettings(tx);
    await lockItems(tx, grn.lines.map((l) => l.itemId));
    const items = await itemMap(tx, grn.lines.map((l) => l.itemId));

    // Landed cost: freight + other charges allocated by net line value.
    const netGoods = po.lines.reduce((s, l) => s.add(D(l.lineTotal)), ZERO);
    const charges = D(po.freight).add(D(po.otherCharges));
    const chargeFactor = netGoods.gt(0) ? D(1).add(charges.div(netGoods)) : D(1);
    const rate = D(po.exchangeRate);

    for (const l of grn.lines) {
      const pol = po.lines.find((x) => x.id === l.poLineId)!;
      const accepted = D(l.acceptedQty);
      const netReceived = D(pol.receivedQty).sub(D(pol.returnedQty));
      const room = maxReceivable(D(pol.quantity), netReceived, D(settings.grnTolerancePct));
      if (accepted.gt(room)) throw new AppError(`Line ${pol.lineNo}: accepting ${accepted} would exceed the ordered quantity plus tolerance.`);
      const it = pol.itemId ? items.get(pol.itemId) : undefined;
      if (it && isStockItem(it) && accepted.gt(0)) {
        const batch = l.batchNo ? await getOrCreateBatch(tx, it.id, l.batchNo, { expiryDate: l.expiryDate, certificateNo: l.certificateNo }) : null;
        const unitNet = D(pol.quantity).gt(0) ? D(pol.lineTotal).div(D(pol.quantity)) : ZERO;
        const unitCost = round4(unitNet.mul(chargeFactor).mul(rate));
        await postStock(tx, ctx, {
          type: "RECEIPT_PO", itemId: it.id, warehouseId: grn.warehouseId, quantity: accepted, unitCost, updatesAvgCost: true,
          batchId: batch?.id, serialNos: parseSerials(l.serialNos), locationId: l.locationId,
          ref: { docType: "GoodsReceipt", docId: grn.id, docNo: grn.number, lineId: l.id }, txnDate: grn.date,
        });
        if (it.purchasePrice.isZero()) await tx.item.update({ where: { id: it.id }, data: { purchasePrice: round4(unitNet.mul(rate)) } });
      }
      await tx.purchaseOrderLine.update({ where: { id: pol.id }, data: { receivedQty: D(pol.receivedQty).add(accepted) } });
      pol.receivedQty = D(pol.receivedQty).add(accepted);
      if (D(l.rejectedQty).gt(0)) {
        await tx.supplierIssue.create({
          data: {
            supplierId: po.supplierId, purchaseOrderId: po.id, goodsReceiptId: grn.id, severity: "MINOR", createdById: ctx.userId,
            description: `GRN ${grn.number}: ${l.rejectedQty} × ${pol.description} rejected — ${l.rejectionReason ?? "no reason"}`,
          },
        });
      }
    }
    const outstanding = po.lines.some((l) => D(l.receivedQty).sub(D(l.returnedQty)).lt(D(l.quantity)));
    if (!po.allowPartial && outstanding && !can(ctx, "purchase.order.approve")) {
      throw new AppError(`${po.number} does not allow partial deliveries. Receive the full quantity or ask a procurement approver to authorise the exception.`);
    }
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: outstanding ? "PARTIALLY_RECEIVED" : "RECEIVED" } });
    const posted = await tx.goodsReceipt.update({ where: { id: grnId }, data: { status: "POSTED", postedById: ctx.userId, postedAt: new Date() } });
    await audit(tx, ctx, { action: "POST", entity: "GoodsReceipt", entityId: grnId, summary: `Posted ${grn.number} against ${po.number} (${outstanding ? "partially received" : "fully received"})` });
    return posted;
  });
}

export async function cancelGoodsReceipt(ctx: Ctx, grnId: string) {
  requirePerm(ctx, "purchase.receipt.manage");
  return withTx(async (tx) => {
    await lockRow(tx, "GoodsReceipt", grnId);
    const g = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: grnId } });
    assertStatus(g.status, ["DRAFT"], "cancel goods receipt");
    await tx.goodsReceipt.update({ where: { id: grnId }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, { action: "CANCEL", entity: "GoodsReceipt", entityId: grnId, summary: `Cancelled ${g.number}` });
  });
}

// ───────── Purchase returns ─────────

export const purchaseReturnSchema = z.object({
  purchaseOrderId: reqStr(40), goodsReceiptId: optId, reason: reqStr(1000),
  lines: z.array(z.object({ poLineId: reqStr(40), quantity: posDecimal, batchNo: optStr(60), serialNos: optStr(4000) })).min(1),
});

/** Creates and posts a return to supplier in one step (stock out + PO returned qty). */
export async function createAndPostPurchaseReturn(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "purchase.return.manage");
  const d = purchaseReturnSchema.parse(raw);
  return withTx(async (tx) => {
    await lockRow(tx, "PurchaseOrder", d.purchaseOrderId);
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: d.purchaseOrderId }, include: { lines: true } });
    assertStatus(po.status, ["PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"], "return goods");
    await lockItems(tx, po.lines.map((l) => l.itemId));
    const items = await itemMap(tx, po.lines.map((l) => l.itemId));
    const number = await nextNumber(tx, "PURCHASE_RETURN");
    const ret = await tx.purchaseReturn.create({
      data: {
        number, supplierId: po.supplierId, purchaseOrderId: po.id, goodsReceiptId: d.goodsReceiptId, warehouseId: po.warehouseId,
        reason: d.reason, status: "POSTED", createdById: ctx.userId, postedById: ctx.userId, postedAt: new Date(),
      },
    });
    for (const l of d.lines) {
      const pol = po.lines.find((x) => x.id === l.poLineId);
      if (!pol || !pol.itemId) throw new AppError("Invalid return line.");
      const qty = D(l.quantity);
      const returnable = D(pol.receivedQty).sub(D(pol.returnedQty));
      if (qty.gt(returnable)) throw new AppError(`Line ${pol.lineNo}: only ${returnable} can be returned.`);
      const it = items.get(pol.itemId)!;
      const rl = await tx.purchaseReturnLine.create({ data: { returnId: ret.id, poLineId: pol.id, itemId: it.id, quantity: qty, batchNo: l.batchNo, serialNos: l.serialNos } });
      if (isStockItem(it)) {
        await assertAvailable(tx, it.id, po.warehouseId, qty, { itemCode: it.code });
        const serials = parseSerials(l.serialNos);
        const lots = it.serialTracked ? [{ batchId: null as string | null, quantity: qty }] : await allocateLots(tx, it.id, po.warehouseId, qty, l.batchNo);
        for (const lot of lots) {
          await postStock(tx, ctx, {
            type: "RETURN_TO_SUPPLIER", itemId: it.id, warehouseId: po.warehouseId, quantity: lot.quantity.neg(), batchId: lot.batchId,
            serialNos: serials, serialOutStatus: "RETURNED_TO_SUPPLIER", ref: { docType: "PurchaseReturn", docId: ret.id, docNo: number, lineId: rl.id },
            notes: d.reason,
          });
        }
      }
      await tx.purchaseOrderLine.update({ where: { id: pol.id }, data: { returnedQty: D(pol.returnedQty).add(qty) } });
    }
    if (po.status === "RECEIVED") await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "PARTIALLY_RECEIVED" } });
    await audit(tx, ctx, { action: "POST", entity: "PurchaseReturn", entityId: ret.id, summary: `Returned goods to supplier (${number}) against ${po.number}` });
    return ret;
  });
}

// ───────── Queries ─────────

export async function listPurchaseOrders(ctx: Ctx, a: ListArgs & { status?: string; supplierId?: string; from?: Date; to?: Date; overdue?: boolean }) {
  requirePerm(ctx, "purchase.view");
  const where: Prisma.PurchaseOrderWhereInput = {
    ...(a.status === "OPEN" ? { status: { in: ["SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED"] } } : a.status ? { status: a.status as never } : {}),
    ...(a.overdue ? { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] }, expectedDate: { lt: new Date() } } : {}),
    ...(a.supplierId ? { supplierId: a.supplierId } : {}),
    ...(a.from || a.to ? { date: { ...(a.from ? { gte: a.from } : {}), ...(a.to ? { lte: a.to } : {}) } } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { supplierQuoteRef: { contains: a.q, mode: "insensitive" } }, { supplier: { legalName: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, skip, take, include: { supplier: { select: { code: true, legalName: true } } }, orderBy: orderBy(a, ["number", "date", "total", "status", "expectedDate"], { date: "desc" }) }),
    prisma.purchaseOrder.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function listPurchaseRequests(ctx: Ctx, a: ListArgs & { status?: string }) {
  requirePerm(ctx, "purchase.view");
  const where: Prisma.PurchaseRequestWhereInput = {
    ...(a.status ? { status: a.status as never } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { justification: { contains: a.q, mode: "insensitive" } }, { department: { contains: a.q, mode: "insensitive" } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.purchaseRequest.findMany({ where, skip, take, orderBy: orderBy(a, ["number", "date", "status", "estimatedTotal", "requiredDate"], { date: "desc" }) }),
    prisma.purchaseRequest.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function listGoodsReceipts(ctx: Ctx, a: ListArgs & { status?: string }) {
  requirePerm(ctx, "purchase.view");
  const where: Prisma.GoodsReceiptWhereInput = {
    ...(a.status ? { status: a.status as never } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { purchaseOrder: { number: { contains: a.q, mode: "insensitive" } } }, { supplier: { legalName: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.goodsReceipt.findMany({ where, skip, take, include: { supplier: { select: { legalName: true } }, purchaseOrder: { select: { number: true } } }, orderBy: orderBy(a, ["number", "date", "status"], { date: "desc" }) }),
    prisma.goodsReceipt.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export { decimalStr };
