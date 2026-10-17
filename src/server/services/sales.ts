import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, withTx, type Tx } from "../db";
import { requirePerm, requireAny, type Ctx } from "../context";
import { audit } from "../audit";
import { nextNumber } from "../numbering";
import { AppError, NotFoundError } from "../errors";
import { assertCanApprove, recordApproval } from "../approvals";
import { commercialLine, optDate, optId, optStr, reqStr, posDecimal, type CommercialLine } from "@/lib/validation";
import { D, ZERO, calcLine, calcTotals, type Dec } from "@/lib/decimal";
import { assertStatus, getSettings, lockRow, paging, orderBy, rateFor, toBase, type ListArgs } from "./common";
import {
  allocateLots, assertAvailable, isStockItem, lockItems, onHand, parseSerials, postStock, reservedQty,
} from "./inventory-engine";

// ───────── shared helpers ─────────

async function prepareLines(tx: Tx, lines: CommercialLine[]) {
  const ids = lines.map((l) => l.itemId).filter((x): x is string => !!x);
  const items = new Map((await tx.item.findMany({ where: { id: { in: ids } }, include: { uom: true } })).map((i) => [i.id, i]));
  return lines.map((l, i) => {
    const item = l.itemId ? items.get(l.itemId) : undefined;
    if (l.itemId && !item) throw new AppError(`Line ${i + 1}: item not found.`);
    if (item && !item.active) throw new AppError(`Line ${i + 1}: item ${item.code} is inactive.`);
    const c = calcLine(l);
    return {
      lineNo: i + 1, itemId: l.itemId ?? null, description: l.description, quantity: D(l.quantity),
      uom: l.uom ?? item?.uom.code ?? null, unitPrice: D(l.unitPrice), discountPct: D(l.discountPct), taxRate: D(l.taxRate),
      lineTotal: c.lineTotal, taxAmount: c.taxAmount,
    };
  });
}

const headerBase = {
  customerId: reqStr(40),
  contactId: optId,
  date: optDate,
  currency: reqStr(3).default("QAR"),
  paymentTerms: optStr(200),
  deliveryTerms: optStr(200),
  notes: optStr(4000),
  lines: z.array(commercialLine).min(1, "Add at least one line"),
};

export const quotationSchema = z.object({ ...headerBase, reference: optStr(100), validUntil: optDate });
export const salesOrderSchema = z.object({
  ...headerBase, customerPoRef: optStr(100), requiredDate: optDate, warehouseId: reqStr(40), shippingAddress: optStr(500),
});

async function assertCustomer(tx: Tx, id: string) {
  const c = await tx.customer.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Customer");
  if (!c.active) throw new AppError(`Customer ${c.code} is inactive.`);
  return c;
}

// ───────── Quotations ─────────

export async function saveQuotation(ctx: Ctx, id: string | null, raw: unknown) {
  requirePerm(ctx, "sales.quotation.manage");
  const d = quotationSchema.parse(raw);
  return withTx(async (tx) => {
    await assertCustomer(tx, d.customerId);
    const lines = await prepareLines(tx, d.lines);
    const totals = calcTotals(lines);
    const rate = await rateFor(tx, d.currency);
    const header = {
      customerId: d.customerId, contactId: d.contactId ?? null, reference: d.reference, currency: d.currency, exchangeRate: rate,
      validUntil: d.validUntil, paymentTerms: d.paymentTerms, deliveryTerms: d.deliveryTerms, notes: d.notes, ...totals,
      ...(d.date ? { date: d.date } : {}),
    };
    if (id) {
      await lockRow(tx, "SalesQuotation", id);
      const q = await tx.salesQuotation.findUniqueOrThrow({ where: { id } });
      assertStatus(q.status, ["DRAFT"], "edit quotation");
      await tx.salesQuotationLine.deleteMany({ where: { quotationId: id } });
      const upd = await tx.salesQuotation.update({ where: { id }, data: { ...header, lines: { create: lines } } });
      await audit(tx, ctx, { action: "UPDATE", entity: "SalesQuotation", entityId: id, summary: `Updated ${q.number}`, after: { ...header, lines } });
      return upd;
    }
    const number = await nextNumber(tx, "SALES_QUOTATION");
    const q = await tx.salesQuotation.create({ data: { ...header, number, createdById: ctx.userId, lines: { create: lines } } });
    await audit(tx, ctx, { action: "CREATE", entity: "SalesQuotation", entityId: q.id, summary: `Created quotation ${number}` });
    return q;
  });
}

type QAction = "submit" | "approve" | "returnToDraft" | "send" | "accept" | "reject" | "cancel";

export async function quotationAction(ctx: Ctx, id: string, action: QAction, comment?: string) {
  return withTx(async (tx) => {
    await lockRow(tx, "SalesQuotation", id);
    const q = await tx.salesQuotation.findUniqueOrThrow({ where: { id } });
    const set = async (status: Prisma.SalesQuotationUpdateInput["status"], extra: Prisma.SalesQuotationUpdateInput = {}) => {
      await tx.salesQuotation.update({ where: { id }, data: { status, ...extra } });
      await recordApproval(tx, ctx, { docType: "SALES_QUOTATION", docId: id, docNo: q.number, action: action.toUpperCase(), comment, amount: q.total });
      await audit(tx, ctx, { action: action.toUpperCase(), entity: "SalesQuotation", entityId: id, summary: `${q.number}: ${q.status} → ${status}${comment ? ` (${comment})` : ""}` });
    };
    switch (action) {
      case "submit":
        requirePerm(ctx, "sales.quotation.manage"); assertStatus(q.status, ["DRAFT"], "submit");
        return set("SUBMITTED");
      case "approve":
        assertStatus(q.status, ["SUBMITTED"], "approve");
        await assertCanApprove(tx, ctx, { docType: "SALES_QUOTATION", permission: "sales.quotation.approve", createdById: q.createdById, amountBase: toBase(q.total, D(q.exchangeRate)) });
        return set("APPROVED", { approvedById: ctx.userId, approvedAt: new Date() });
      case "returnToDraft":
        requirePerm(ctx, "sales.quotation.approve"); assertStatus(q.status, ["SUBMITTED"], "return to draft");
        if (!comment) throw new AppError("Please give a reason when returning a quotation.");
        return set("DRAFT");
      case "send":
        requirePerm(ctx, "sales.quotation.manage"); assertStatus(q.status, ["APPROVED"], "mark as sent");
        return set("SENT");
      case "accept":
        requirePerm(ctx, "sales.quotation.manage"); assertStatus(q.status, ["SENT", "APPROVED"], "record acceptance");
        return set("ACCEPTED");
      case "reject":
        requirePerm(ctx, "sales.quotation.manage"); assertStatus(q.status, ["SENT", "APPROVED"], "record rejection");
        return set("REJECTED");
      case "cancel":
        requirePerm(ctx, "sales.quotation.manage"); assertStatus(q.status, ["DRAFT", "SUBMITTED", "APPROVED", "SENT"], "cancel");
        return set("CANCELLED");
    }
  });
}

/** Creates a new DRAFT revision; the old quotation is kept as REVISED. */
export async function reviseQuotation(ctx: Ctx, id: string) {
  requirePerm(ctx, "sales.quotation.manage");
  return withTx(async (tx) => {
    await lockRow(tx, "SalesQuotation", id);
    const q = await tx.salesQuotation.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    assertStatus(q.status, ["SUBMITTED", "APPROVED", "SENT", "REJECTED"], "revise");
    const base = q.number.replace(/-R\d+$/, "");
    const rev = q.revision + 1;
    const { id: _id, lines, number: _n, status: _s, approvedAt: _a, approvedById: _b, createdAt: _c, updatedAt: _u, ...rest } = q;
    const copy = await tx.salesQuotation.create({
      data: {
        ...rest, number: `${base}-R${rev}`, revision: rev, parentId: q.id, status: "DRAFT", createdById: ctx.userId, date: new Date(),
        lines: { create: lines.map(({ id: _x, quotationId: _q, ...l }) => l) },
      },
    });
    await tx.salesQuotation.update({ where: { id }, data: { status: "REVISED" } });
    await audit(tx, ctx, { action: "REVISE", entity: "SalesQuotation", entityId: copy.id, summary: `Revised ${q.number} → ${copy.number}` });
    return copy;
  });
}

/** Converts an accepted quotation into a DRAFT sales order, keeping the link. */
export async function convertQuotationToOrder(ctx: Ctx, id: string, warehouseId: string) {
  requirePerm(ctx, "sales.order.manage");
  return withTx(async (tx) => {
    await lockRow(tx, "SalesQuotation", id);
    const q = await tx.salesQuotation.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } }, salesOrder: true } });
    if (q.salesOrder) throw new AppError(`Quotation already converted to ${q.salesOrder.number}.`);
    assertStatus(q.status, ["ACCEPTED"], "convert");
    await assertCustomer(tx, q.customerId);
    const number = await nextNumber(tx, "SALES_ORDER");
    const so = await tx.salesOrder.create({
      data: {
        number, customerId: q.customerId, contactId: q.contactId, quotationId: q.id, currency: q.currency, exchangeRate: q.exchangeRate,
        paymentTerms: q.paymentTerms, deliveryTerms: q.deliveryTerms, notes: q.notes, warehouseId, createdById: ctx.userId,
        subtotal: q.subtotal, discountTotal: q.discountTotal, taxTotal: q.taxTotal, total: q.total, customerPoRef: q.reference,
        lines: { create: q.lines.map((l) => ({
          lineNo: l.lineNo, itemId: l.itemId, description: l.description, quantity: l.quantity, uom: l.uom, unitPrice: l.unitPrice,
          discountPct: l.discountPct, taxRate: l.taxRate, lineTotal: l.lineTotal, taxAmount: l.taxAmount,
        })) },
      },
    });
    await tx.salesQuotation.update({ where: { id }, data: { status: "CONVERTED" } });
    await recordApproval(tx, ctx, { docType: "SALES_QUOTATION", docId: id, docNo: q.number, action: "CONVERT" });
    await audit(tx, ctx, { action: "CONVERT", entity: "SalesQuotation", entityId: id, summary: `Converted ${q.number} to ${number}` });
    return so;
  });
}

// ───────── Sales orders ─────────

export async function saveSalesOrder(ctx: Ctx, id: string | null, raw: unknown) {
  requirePerm(ctx, "sales.order.manage");
  const d = salesOrderSchema.parse(raw);
  return withTx(async (tx) => {
    await assertCustomer(tx, d.customerId);
    const lines = await prepareLines(tx, d.lines);
    const totals = calcTotals(lines);
    const rate = await rateFor(tx, d.currency);
    const header = {
      customerId: d.customerId, contactId: d.contactId ?? null, customerPoRef: d.customerPoRef, currency: d.currency, exchangeRate: rate,
      requiredDate: d.requiredDate, warehouseId: d.warehouseId, paymentTerms: d.paymentTerms, deliveryTerms: d.deliveryTerms,
      shippingAddress: d.shippingAddress, notes: d.notes, ...totals, ...(d.date ? { date: d.date } : {}),
    };
    if (id) {
      await lockRow(tx, "SalesOrder", id);
      const so = await tx.salesOrder.findUniqueOrThrow({ where: { id } });
      assertStatus(so.status, ["DRAFT"], "edit order");
      await tx.salesOrderLine.deleteMany({ where: { orderId: id } });
      const upd = await tx.salesOrder.update({ where: { id }, data: { ...header, lines: { create: lines } } });
      await audit(tx, ctx, { action: "UPDATE", entity: "SalesOrder", entityId: id, summary: `Updated ${so.number}`, after: { ...header, lines } });
      return upd;
    }
    const number = await nextNumber(tx, "SALES_ORDER");
    const so = await tx.salesOrder.create({ data: { ...header, number, createdById: ctx.userId, lines: { create: lines } } });
    await audit(tx, ctx, { action: "CREATE", entity: "SalesOrder", entityId: so.id, summary: `Created sales order ${number}` });
    return so;
  });
}

export async function salesOrderAction(ctx: Ctx, id: string, action: "submit" | "approve" | "returnToDraft" | "cancel" | "close", comment?: string) {
  return withTx(async (tx) => {
    await lockRow(tx, "SalesOrder", id);
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    const log = async (status: string) => {
      await recordApproval(tx, ctx, { docType: "SALES_ORDER", docId: id, docNo: so.number, action: action.toUpperCase(), comment, amount: so.total });
      await audit(tx, ctx, { action: action.toUpperCase(), entity: "SalesOrder", entityId: id, summary: `${so.number}: ${so.status} → ${status}${comment ? ` (${comment})` : ""}` });
    };
    switch (action) {
      case "submit":
        requirePerm(ctx, "sales.order.manage"); assertStatus(so.status, ["DRAFT"], "submit");
        await tx.salesOrder.update({ where: { id }, data: { status: "SUBMITTED" } }); return log("SUBMITTED");
      case "approve":
        assertStatus(so.status, ["SUBMITTED"], "approve");
        await assertCanApprove(tx, ctx, { docType: "SALES_ORDER", permission: "sales.order.approve", createdById: so.createdById, amountBase: toBase(so.total, D(so.exchangeRate)) });
        await tx.salesOrder.update({ where: { id }, data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() } });
        return log("APPROVED");
      case "returnToDraft":
        requirePerm(ctx, "sales.order.approve"); assertStatus(so.status, ["SUBMITTED"], "return to draft");
        if (!comment) throw new AppError("Please give a reason.");
        await tx.salesOrder.update({ where: { id }, data: { status: "DRAFT" } }); return log("DRAFT");
      case "cancel": {
        requireAny(ctx, "sales.order.manage", "sales.order.approve");
        assertStatus(so.status, ["DRAFT", "SUBMITTED", "APPROVED"], "cancel");
        if (so.lines.some((l) => D(l.deliveredQty).gt(0))) throw new AppError("Cannot cancel: goods already delivered. Close the order instead.");
        const drafts = await tx.deliveryOrder.count({ where: { salesOrderId: id, status: "DRAFT" } });
        if (drafts) throw new AppError("Cancel the draft delivery orders first.");
        await releaseAll(tx, so.lines.map((l) => l.id));
        await tx.salesOrder.update({ where: { id }, data: { status: "CANCELLED" } }); return log("CANCELLED");
      }
      case "close":
        requirePerm(ctx, "sales.order.approve"); assertStatus(so.status, ["APPROVED", "PARTIALLY_DELIVERED"], "close");
        await releaseAll(tx, so.lines.map((l) => l.id));
        await tx.salesOrder.update({ where: { id }, data: { status: "CLOSED" } }); return log("CLOSED");
    }
  });
}

async function releaseAll(tx: Tx, lineIds: string[]) {
  await tx.stockReservation.updateMany({ where: { salesOrderLineId: { in: lineIds }, status: "ACTIVE" }, data: { status: "RELEASED", quantity: 0 } });
}

/** Availability for every line of a sales order at its fulfilment warehouse. */
export async function orderAvailability(tx: Tx, orderId: string) {
  const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  const items = new Map((await tx.item.findMany({ where: { id: { in: so.lines.map((l) => l.itemId!).filter(Boolean) } } })).map((i) => [i.id, i]));
  const out = [];
  for (const l of so.lines) {
    const item = l.itemId ? items.get(l.itemId) : undefined;
    const outstanding = D(l.quantity).sub(D(l.deliveredQty));
    if (!item || !isStockItem(item)) {
      out.push({ lineId: l.id, stocked: false, outstanding, reservedForLine: ZERO, onHand: ZERO, available: ZERO, shortage: ZERO });
      continue;
    }
    const [oh, allRes, lineResAgg] = await Promise.all([
      onHand(tx, item.id, so.warehouseId), reservedQty(tx, item.id, so.warehouseId),
      tx.stockReservation.aggregate({ where: { salesOrderLineId: l.id, status: "ACTIVE" }, _sum: { quantity: true } }),
    ]);
    const lineRes = D(lineResAgg._sum.quantity);
    const available = oh.sub(allRes); // free stock not reserved by anyone
    const needed = outstanding.sub(lineRes);
    const shortage = needed.sub(available).gt(0) ? needed.sub(available) : ZERO;
    out.push({ lineId: l.id, stocked: true, outstanding, reservedForLine: lineRes, onHand: oh, available, shortage });
  }
  return out;
}

/** Reserves free stock for outstanding quantities of an approved order. */
export async function reserveOrderStock(ctx: Ctx, orderId: string) {
  requirePerm(ctx, "sales.reserve");
  return withTx(async (tx) => {
    await lockRow(tx, "SalesOrder", orderId);
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    assertStatus(so.status, ["APPROVED", "PARTIALLY_DELIVERED"], "reserve stock");
    await lockItems(tx, so.lines.map((l) => l.itemId));
    const items = new Map((await tx.item.findMany({ where: { id: { in: so.lines.map((l) => l.itemId!).filter(Boolean) } } })).map((i) => [i.id, i]));
    let reservedTotal = ZERO;
    const shortages: string[] = [];
    for (const l of so.lines) {
      const item = l.itemId ? items.get(l.itemId) : undefined;
      if (!item || !isStockItem(item)) continue;
      const lineRes = D((await tx.stockReservation.aggregate({ where: { salesOrderLineId: l.id, status: "ACTIVE" }, _sum: { quantity: true } }))._sum.quantity);
      const need = D(l.quantity).sub(D(l.deliveredQty)).sub(lineRes);
      if (need.lte(0)) continue;
      const free = (await onHand(tx, item.id, so.warehouseId)).sub(await reservedQty(tx, item.id, so.warehouseId));
      const take = free.lt(need) ? (free.gt(0) ? free : ZERO) : need;
      if (take.lt(need)) shortages.push(`${item.code}: short ${need.sub(take).toString()}`);
      if (take.gt(0)) {
        await tx.stockReservation.create({ data: { salesOrderLineId: l.id, itemId: item.id, warehouseId: so.warehouseId, quantity: take, createdById: ctx.userId } });
        reservedTotal = reservedTotal.add(take);
      }
    }
    await audit(tx, ctx, { action: "RESERVE", entity: "SalesOrder", entityId: orderId, summary: `Reserved ${reservedTotal} unit(s) for ${so.number}${shortages.length ? `; shortages: ${shortages.join(", ")}` : ""}` });
    return { reserved: reservedTotal.toString(), shortages };
  });
}

export async function releaseOrderReservations(ctx: Ctx, orderId: string) {
  requirePerm(ctx, "sales.reserve");
  return withTx(async (tx) => {
    await lockRow(tx, "SalesOrder", orderId);
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    await releaseAll(tx, so.lines.map((l) => l.id));
    await audit(tx, ctx, { action: "RELEASE", entity: "SalesOrder", entityId: orderId, summary: `Released reservations for ${so.number}` });
  });
}

/** Example C/A: shortage on a sales order → draft purchase request. */
export async function purchaseRequestFromShortage(ctx: Ctx, orderId: string) {
  requirePerm(ctx, "purchase.request.manage");
  return withTx(async (tx) => {
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const av = await orderAvailability(tx, orderId);
    const short = av.filter((a) => a.stocked && a.shortage.gt(0));
    if (!short.length) throw new AppError("No stock shortage on this order.");
    const items = new Map((await tx.item.findMany({ where: { id: { in: so.lines.map((l) => l.itemId!).filter(Boolean) } }, include: { uom: true } })).map((i) => [i.id, i]));
    const number = await nextNumber(tx, "PURCHASE_REQUEST");
    const lines = short.map((s, i) => {
      const l = so.lines.find((x) => x.id === s.lineId)!;
      const it = items.get(l.itemId!)!;
      return { lineNo: i + 1, itemId: it.id, description: `${it.code} — ${it.name}`, quantity: s.shortage, uom: it.uom.code, estimatedUnitPrice: it.purchasePrice, requiredDate: so.requiredDate };
    });
    const pr = await tx.purchaseRequest.create({
      data: {
        number, requestedById: ctx.userId, source: "SALES_SHORTAGE", salesOrderId: so.id, requiredDate: so.requiredDate,
        justification: `Stock shortage for sales order ${so.number}`,
        estimatedTotal: lines.reduce((s, l) => s.add(D(l.quantity).mul(D(l.estimatedUnitPrice))), ZERO).toDecimalPlaces(2),
        lines: { create: lines },
      },
    });
    await audit(tx, ctx, { action: "CREATE", entity: "PurchaseRequest", entityId: pr.id, summary: `Created ${number} from shortage on ${so.number}` });
    return pr;
  });
}

// ───────── Delivery orders ─────────

export const deliverySchema = z.object({
  salesOrderId: reqStr(40),
  date: optDate,
  shippingAddress: optStr(500),
  vehicleNo: optStr(40),
  driverName: optStr(80),
  notes: optStr(2000),
  lines: z.array(z.object({
    salesOrderLineId: reqStr(40), quantity: posDecimal, batchNo: optStr(60), serialNos: optStr(4000),
  })).min(1, "Add at least one line"),
});

export async function createDelivery(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "sales.delivery.manage");
  const d = deliverySchema.parse(raw);
  return withTx(async (tx) => {
    await lockRow(tx, "SalesOrder", d.salesOrderId);
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: d.salesOrderId }, include: { lines: true } });
    assertStatus(so.status, ["APPROVED", "PARTIALLY_DELIVERED"], "create a delivery");
    const pending = await pendingDeliveryQty(tx, so.id);
    for (const l of d.lines) {
      const sol = so.lines.find((x) => x.id === l.salesOrderLineId);
      if (!sol) throw new AppError("Delivery line does not belong to this order.");
      const open = D(sol.quantity).sub(D(sol.deliveredQty)).sub(pending.get(sol.id) ?? ZERO);
      if (D(l.quantity).gt(open)) throw new AppError(`Line ${sol.lineNo}: quantity exceeds the undelivered quantity (${open}).`);
    }
    const number = await nextNumber(tx, "DELIVERY_ORDER");
    const dlv = await tx.deliveryOrder.create({
      data: {
        number, salesOrderId: so.id, customerId: so.customerId, warehouseId: so.warehouseId, date: d.date ?? new Date(),
        shippingAddress: d.shippingAddress ?? so.shippingAddress, vehicleNo: d.vehicleNo, driverName: d.driverName, notes: d.notes,
        createdById: ctx.userId,
        lines: { create: d.lines.map((l) => {
          const sol = so.lines.find((x) => x.id === l.salesOrderLineId)!;
          return { salesOrderLineId: sol.id, itemId: sol.itemId, description: sol.description, quantity: D(l.quantity), batchNo: l.batchNo, serialNos: l.serialNos };
        }) },
      },
    });
    await audit(tx, ctx, { action: "CREATE", entity: "DeliveryOrder", entityId: dlv.id, summary: `Created delivery ${number} for ${so.number}` });
    return dlv;
  });
}

async function pendingDeliveryQty(tx: Tx, salesOrderId: string, excludeDeliveryId?: string) {
  const lines = await tx.deliveryOrderLine.findMany({
    where: { delivery: { salesOrderId, status: "DRAFT", ...(excludeDeliveryId ? { id: { not: excludeDeliveryId } } : {}) } },
  });
  const m = new Map<string, Dec>();
  for (const l of lines) m.set(l.salesOrderLineId, (m.get(l.salesOrderLineId) ?? ZERO).add(D(l.quantity)));
  return m;
}

/**
 * Posts a delivery: issues stock exactly once (row lock + status check),
 * consumes the order's reservation, updates delivered quantities and the
 * order fulfilment status — all in one transaction.
 */
export async function postDelivery(ctx: Ctx, deliveryId: string) {
  requirePerm(ctx, "sales.delivery.post");
  return withTx(async (tx) => {
    await lockRow(tx, "DeliveryOrder", deliveryId);
    const dlv = await tx.deliveryOrder.findUniqueOrThrow({ where: { id: deliveryId }, include: { lines: true } });
    assertStatus(dlv.status, ["DRAFT"], "post delivery");
    await lockRow(tx, "SalesOrder", dlv.salesOrderId);
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: dlv.salesOrderId }, include: { lines: true } });
    assertStatus(so.status, ["APPROVED", "PARTIALLY_DELIVERED"], "deliver against this order");
    const settings = await getSettings(tx);
    await lockItems(tx, dlv.lines.map((l) => l.itemId));
    const items = new Map((await tx.item.findMany({ where: { id: { in: dlv.lines.map((l) => l.itemId!).filter(Boolean) } } })).map((i) => [i.id, i]));

    for (const l of dlv.lines) {
      const sol = so.lines.find((x) => x.id === l.salesOrderLineId)!;
      const qty = D(l.quantity);
      const open = D(sol.quantity).sub(D(sol.deliveredQty));
      if (qty.gt(open)) throw new AppError(`Line ${sol.lineNo}: delivering ${qty} exceeds the outstanding quantity ${open}.`);
      const item = l.itemId ? items.get(l.itemId) : undefined;
      if (item && isStockItem(item)) {
        await assertAvailable(tx, item.id, dlv.warehouseId, qty, { ownSoLineId: sol.id, allowNegative: settings.allowNegativeStock && ctx.permissions.has("inventory.negative"), itemCode: item.code });
        const serials = parseSerials(l.serialNos);
        let lots: { batchId: string | null; quantity: Dec; serials?: string[] }[];
        if (item.serialTracked) {
          if (serials.length !== qty.toNumber()) throw new AppError(`${item.code}: enter ${qty} serial number(s).`);
          const recs = await tx.serialNumber.findMany({ where: { itemId: item.id, serialNo: { in: serials } } });
          const g = new Map<string, string[]>();
          for (const s of serials) { const k = recs.find((r) => r.serialNo === s)?.batchId ?? ""; g.set(k, [...(g.get(k) ?? []), s]); }
          lots = [...g.entries()].map(([k, list]) => ({ batchId: k || null, quantity: D(list.length), serials: list }));
        } else {
          lots = await allocateLots(tx, item.id, dlv.warehouseId, qty, l.batchNo);
        }
        for (const lot of lots) {
          await postStock(tx, ctx, {
            type: "ISSUE_DELIVERY", itemId: item.id, warehouseId: dlv.warehouseId, quantity: lot.quantity.neg(), batchId: lot.batchId,
            serialNos: lot.serials ?? [], serialOutStatus: item.inventoryClass === "RENTAL" ? "RENTED_OUT" : "DELIVERED",
            ref: { docType: "DeliveryOrder", docId: dlv.id, docNo: dlv.number, lineId: l.id }, txnDate: dlv.date,
            allowNegative: settings.allowNegativeStock && ctx.permissions.has("inventory.negative"),
          });
        }
        // Consume this line's reservations.
        let toConsume = qty;
        const res = await tx.stockReservation.findMany({ where: { salesOrderLineId: sol.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
        for (const r of res) {
          if (toConsume.lte(0)) break;
          const use = D(r.quantity).lt(toConsume) ? D(r.quantity) : toConsume;
          const left = D(r.quantity).sub(use);
          await tx.stockReservation.update({ where: { id: r.id }, data: { quantity: left, status: left.isZero() ? "CONSUMED" : "ACTIVE" } });
          toConsume = toConsume.sub(use);
        }
      }
      await tx.salesOrderLine.update({ where: { id: sol.id }, data: { deliveredQty: D(sol.deliveredQty).add(qty) } });
      sol.deliveredQty = D(sol.deliveredQty).add(qty);
    }
    const allDone = so.lines.every((l) => D(l.deliveredQty).gte(D(l.quantity)));
    await tx.salesOrder.update({ where: { id: so.id }, data: { status: allDone ? "DELIVERED" : "PARTIALLY_DELIVERED" } });
    if (allDone) await releaseAll(tx, so.lines.map((l) => l.id));
    const posted = await tx.deliveryOrder.update({ where: { id: deliveryId }, data: { status: "POSTED", postedById: ctx.userId, postedAt: new Date() } });
    await audit(tx, ctx, { action: "POST", entity: "DeliveryOrder", entityId: deliveryId, summary: `Posted delivery ${dlv.number} (${so.number} → ${allDone ? "DELIVERED" : "PARTIALLY DELIVERED"})` });
    return posted;
  });
}

export async function cancelDelivery(ctx: Ctx, deliveryId: string) {
  requirePerm(ctx, "sales.delivery.manage");
  return withTx(async (tx) => {
    await lockRow(tx, "DeliveryOrder", deliveryId);
    const d = await tx.deliveryOrder.findUniqueOrThrow({ where: { id: deliveryId } });
    assertStatus(d.status, ["DRAFT"], "cancel delivery");
    await tx.deliveryOrder.update({ where: { id: deliveryId }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, { action: "CANCEL", entity: "DeliveryOrder", entityId: deliveryId, summary: `Cancelled delivery ${d.number}` });
  });
}

// ───────── Queries ─────────

export async function listQuotations(ctx: Ctx, a: ListArgs & { status?: string; customerId?: string; from?: Date; to?: Date }) {
  requirePerm(ctx, "sales.view");
  const where: Prisma.SalesQuotationWhereInput = {
    ...(a.status ? { status: a.status as never } : {}),
    ...(a.customerId ? { customerId: a.customerId } : {}),
    ...(a.from || a.to ? { date: { ...(a.from ? { gte: a.from } : {}), ...(a.to ? { lte: a.to } : {}) } } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { reference: { contains: a.q, mode: "insensitive" } }, { customer: { legalName: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.salesQuotation.findMany({ where, skip, take, include: { customer: { select: { code: true, legalName: true } } }, orderBy: orderBy(a, ["number", "date", "total", "status", "validUntil"], { date: "desc" }) }),
    prisma.salesQuotation.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function listSalesOrders(ctx: Ctx, a: ListArgs & { status?: string; customerId?: string; from?: Date; to?: Date }) {
  requirePerm(ctx, "sales.view");
  const where: Prisma.SalesOrderWhereInput = {
    ...(a.status === "OPEN" ? { status: { in: ["SUBMITTED", "APPROVED", "PARTIALLY_DELIVERED"] } } : a.status ? { status: a.status as never } : {}),
    ...(a.customerId ? { customerId: a.customerId } : {}),
    ...(a.from || a.to ? { date: { ...(a.from ? { gte: a.from } : {}), ...(a.to ? { lte: a.to } : {}) } } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { customerPoRef: { contains: a.q, mode: "insensitive" } }, { customer: { legalName: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.salesOrder.findMany({ where, skip, take, include: { customer: { select: { code: true, legalName: true } } }, orderBy: orderBy(a, ["number", "date", "total", "status", "requiredDate"], { date: "desc" }) }),
    prisma.salesOrder.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function listDeliveries(ctx: Ctx, a: ListArgs & { status?: string }) {
  requirePerm(ctx, "sales.view");
  const where: Prisma.DeliveryOrderWhereInput = {
    ...(a.status ? { status: a.status as never } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { salesOrder: { number: { contains: a.q, mode: "insensitive" } } }, { customer: { legalName: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.deliveryOrder.findMany({ where, skip, take, include: { customer: { select: { legalName: true } }, salesOrder: { select: { number: true } } }, orderBy: orderBy(a, ["number", "date", "status"], { date: "desc" }) }),
    prisma.deliveryOrder.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}
