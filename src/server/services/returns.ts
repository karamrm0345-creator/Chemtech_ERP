/**
 * Customer returns, credit notes and supplier debit notes.
 *
 * - A customer return brings delivered goods back into stock at the cost they
 *   were issued at (inventory against cost of sales).
 * - A credit note reverses revenue and tax on a posted sales invoice and is
 *   applied to that invoice's balance; any excess stays as customer credit.
 * - A debit note reduces a supplier invoice; for goods sent back with a
 *   purchase return it clears the GRNI the return booked.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, withTx, type Tx } from "../db";
import { requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { nextNumber } from "../numbering";
import { AppError } from "../errors";
import { decimalStr, optDate, optId, optStr, posDecimal, reqStr } from "@/lib/validation";
import { D, ZERO, calcLine, round2, round4, type Dec } from "@/lib/decimal";
import { isStockItem, lockItems, parseSerials, postStock } from "./inventory-engine";
import { postCreditNoteJournal, postDebitNoteJournal, postStockJournal } from "../accounting/postings";
import { allocateToPurchaseInvoice, allocateToSalesInvoice } from "./payments";
import { assertStatus, lockRow, orderBy, paging, type ListArgs } from "./common";

// ───────── Customer returns ─────────

export const customerReturnSchema = z.object({
  deliveryId: reqStr(40),
  reason: reqStr(1000),
  date: optDate,
  lines: z.array(z.object({ deliveryLineId: reqStr(40), quantity: posDecimal, batchNo: optStr(60), serialNos: optStr(4000) })).min(1, "Add at least one line"),
});

/** Records and posts goods returned against a posted delivery. */
export async function createCustomerReturn(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "sales.return.manage");
  const d = customerReturnSchema.parse(raw);
  return withTx(async (tx) => {
    await lockRow(tx, "DeliveryOrder", d.deliveryId);
    const dlv = await tx.deliveryOrder.findUniqueOrThrow({ where: { id: d.deliveryId }, include: { lines: true } });
    assertStatus(dlv.status, ["POSTED"], "return goods from this delivery");
    const items = new Map((await tx.item.findMany({ where: { id: { in: dlv.lines.map((l) => l.itemId!).filter(Boolean) } } })).map((i) => [i.id, i]));
    await lockItems(tx, dlv.lines.map((l) => l.itemId));
    const number = await nextNumber(tx, "CUSTOMER_RETURN");
    const date = d.date ?? new Date();
    const ret = await tx.customerReturn.create({
      data: {
        number, date, customerId: dlv.customerId, deliveryId: dlv.id, salesOrderId: dlv.salesOrderId, warehouseId: dlv.warehouseId,
        reason: d.reason, status: "POSTED", createdById: ctx.userId, postedById: ctx.userId, postedAt: new Date(),
      },
    });
    for (const l of d.lines) {
      const dl = dlv.lines.find((x) => x.id === l.deliveryLineId);
      if (!dl) throw new AppError("Return line does not belong to this delivery.");
      const qty = D(l.quantity);
      const returnable = D(dl.quantity).sub(D(dl.returnedQty));
      if (qty.gt(returnable)) throw new AppError(`${dl.description}: only ${returnable} can be returned.`);
      const rl = await tx.customerReturnLine.create({
        data: { returnId: ret.id, deliveryLineId: dl.id, soLineId: dl.salesOrderLineId, itemId: dl.itemId ?? "", description: dl.description, quantity: qty, batchNo: l.batchNo, serialNos: l.serialNos },
      });
      const item = dl.itemId ? items.get(dl.itemId) : undefined;
      if (item && isStockItem(item)) {
        // Value the return at the cost the goods were issued at on this delivery line.
        const issued = await tx.inventoryTransaction.findMany({ where: { refDocType: "DeliveryOrder", refDocId: dlv.id, refLineId: dl.id } });
        const issuedQty = issued.reduce((s, r) => s.add(D(r.quantity).abs()), ZERO);
        const issuedValue = issued.reduce((s, r) => s.add(D(r.totalValue).abs()), ZERO);
        const unitCost = issuedQty.gt(0) ? round4(issuedValue.div(issuedQty)) : D(item.avgCost);
        const batches = [...new Set(issued.map((r) => r.batchId).filter(Boolean))] as string[];
        let batchId: string | null = null;
        if (batches.length === 1) batchId = batches[0];
        else if (batches.length > 1) {
          if (!l.batchNo) throw new AppError(`${item.code} was delivered from several batches; enter the batch being returned.`);
          const b = await tx.batch.findUnique({ where: { itemId_batchNo: { itemId: item.id, batchNo: l.batchNo } } });
          if (!b || !batches.includes(b.id)) throw new AppError(`${item.code}: batch ${l.batchNo} was not delivered on ${dlv.number}.`);
          batchId = b.id;
        }
        const serials = parseSerials(l.serialNos);
        if (item.serialTracked) {
          const delivered = new Set(issued.flatMap((r) => parseSerials(r.serialNos)));
          const wrong = serials.filter((s) => !delivered.has(s));
          if (wrong.length) throw new AppError(`${item.code}: serial(s) ${wrong.join(", ")} were not delivered on ${dlv.number}.`);
        }
        await postStock(tx, ctx, {
          type: "RETURN_FROM_CUSTOMER", itemId: item.id, warehouseId: dlv.warehouseId, quantity: qty, unitCost, updatesAvgCost: true,
          batchId, serialNos: serials, ref: { docType: "CustomerReturn", docId: ret.id, docNo: number, lineId: rl.id }, notes: d.reason, txnDate: date,
        });
      }
      await tx.deliveryOrderLine.update({ where: { id: dl.id }, data: { returnedQty: { increment: qty } } });
      await tx.salesOrderLine.update({ where: { id: dl.salesOrderLineId }, data: { returnedQty: { increment: qty } } });
    }
    await postStockJournal(tx, ctx, { type: "CustomerReturn", id: ret.id, no: number, memo: `Customer return ${number} against ${dlv.number}` });
    await audit(tx, ctx, { action: "POST", entity: "CustomerReturn", entityId: ret.id, summary: `Received customer return ${number} against ${dlv.number}: ${d.reason}` });
    return ret;
  });
}

export async function listCustomerReturns(ctx: Ctx, a: ListArgs & { customerId?: string }) {
  requirePerm(ctx, "sales.view");
  const where: Prisma.CustomerReturnWhereInput = {
    ...(a.customerId ? { customerId: a.customerId } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { reason: { contains: a.q, mode: "insensitive" } }, { customer: { legalName: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.customerReturn.findMany({ where, skip, take, include: { customer: { select: { legalName: true } }, delivery: { select: { number: true } } }, orderBy: orderBy(a, ["number", "date"], { date: "desc" }) }),
    prisma.customerReturn.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

// ───────── Credit notes ─────────

export const creditNoteSchema = z.object({
  invoiceId: reqStr(40),
  reason: reqStr(1000),
  date: optDate,
  customerReturnId: optId,
  lines: z.array(z.object({ invoiceLineId: reqStr(40), quantity: posDecimal, unitPrice: decimalStr.optional() })).min(1, "Add at least one line"),
});

/** Quantity of each invoice line still open for crediting (posted and draft credit notes deducted). */
async function creditable(tx: Tx, invoiceId: string) {
  const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } });
  const drafts = await tx.creditNoteLine.groupBy({ by: ["invoiceLineId"], where: { creditNote: { invoiceId, status: "DRAFT" } }, _sum: { quantity: true } });
  return inv.lines.map((l) => ({ line: l, open: D(l.quantity).sub(D(l.creditedQty)).sub(D(drafts.find((x) => x.invoiceLineId === l.id)?._sum.quantity)) }));
}

export async function creditableLines(invoiceId: string) {
  return creditable(prisma as unknown as Tx, invoiceId);
}

export async function createCreditNote(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "finance.sales.manage");
  const d = creditNoteSchema.parse(raw);
  return withTx(async (tx) => {
    await lockRow(tx, "SalesInvoice", d.invoiceId);
    const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: d.invoiceId } });
    assertStatus(inv.status, ["POSTED", "PARTIALLY_PAID", "PAID"], "issue a credit note");
    if (d.customerReturnId) {
      const r = await tx.customerReturn.findUniqueOrThrow({ where: { id: d.customerReturnId } });
      if (r.customerId !== inv.customerId) throw new AppError("The customer return belongs to another customer.");
    }
    const open = await creditable(tx, inv.id);
    const lines = d.lines.map((x) => {
      const o = open.find((y) => y.line.id === x.invoiceLineId);
      if (!o) throw new AppError("Credit note line does not belong to this invoice.");
      if (D(x.quantity).gt(o.open)) throw new AppError(`${o.line.description}: only ${o.open} can still be credited.`);
      const unitPrice = x.unitPrice !== undefined && x.unitPrice !== "" ? D(x.unitPrice) : D(o.line.unitPrice);
      if (unitPrice.lt(0) || unitPrice.gt(D(o.line.unitPrice))) throw new AppError(`${o.line.description}: the credit price cannot exceed the invoiced price ${D(o.line.unitPrice).toFixed(2)}.`);
      const c = calcLine({ quantity: x.quantity, unitPrice, discountPct: o.line.discountPct, taxRate: o.line.taxRate });
      return {
        invoiceLineId: o.line.id, itemId: o.line.itemId, description: o.line.description, quantity: D(x.quantity), unitPrice,
        discountPct: o.line.discountPct, taxRate: o.line.taxRate, lineTotal: c.lineTotal, taxAmount: c.taxAmount,
      };
    });
    const subtotal = lines.reduce((s, l) => s.add(l.lineTotal), ZERO);
    const taxTotal = lines.reduce((s, l) => s.add(l.taxAmount), ZERO);
    if (!subtotal.add(taxTotal).gt(0)) throw new AppError("The credit note total must be greater than zero.");
    const number = await nextNumber(tx, "CREDIT_NOTE");
    const cn = await tx.creditNote.create({
      data: {
        number, date: d.date ?? new Date(), customerId: inv.customerId, invoiceId: inv.id, customerReturnId: d.customerReturnId, currency: inv.currency,
        exchangeRate: inv.exchangeRate, reason: d.reason, subtotal, taxTotal, total: subtotal.add(taxTotal), createdById: ctx.userId, lines: { create: lines },
      },
    });
    await audit(tx, ctx, { action: "CREATE", entity: "CreditNote", entityId: cn.id, summary: `Prepared credit note ${number} for ${inv.number}: ${d.reason}` });
    return cn;
  });
}

/** Posts a credit note and applies it to its invoice's open balance; any excess remains as customer credit. */
export async function postCreditNote(ctx: Ctx, id: string) {
  requirePerm(ctx, "finance.sales.manage");
  return withTx(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT id FROM "CreditNote" WHERE id = $1 FOR UPDATE`, id);
    const cn = await tx.creditNote.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    assertStatus(cn.status, ["DRAFT"], "post credit note");
    await lockRow(tx, "SalesInvoice", cn.invoiceId);
    for (const l of cn.lines) {
      const il = await tx.salesInvoiceLine.findUniqueOrThrow({ where: { id: l.invoiceLineId } });
      if (D(il.creditedQty).add(D(l.quantity)).gt(D(il.quantity))) throw new AppError(`${il.description}: credited quantity would exceed the invoiced quantity.`);
      await tx.salesInvoiceLine.update({ where: { id: il.id }, data: { creditedQty: { increment: D(l.quantity) } } });
    }
    if (cn.customerReturnId) {
      // Record how much of each returned line this note credits (matched through the sales order line).
      const rlines = await tx.customerReturnLine.findMany({ where: { returnId: cn.customerReturnId } });
      for (const l of cn.lines) {
        const il = await tx.salesInvoiceLine.findUniqueOrThrow({ where: { id: l.invoiceLineId } });
        let left = D(l.quantity);
        for (const rl of rlines.filter((r) => r.soLineId === il.salesOrderLineId)) {
          const room = D(rl.quantity).sub(D(rl.creditedQty));
          const use = room.lt(left) ? room : left;
          if (use.lte(0)) continue;
          await tx.customerReturnLine.update({ where: { id: rl.id }, data: { creditedQty: { increment: use } } });
          rl.creditedQty = D(rl.creditedQty).add(use);
          left = left.sub(use);
        }
      }
    }
    await tx.creditNote.update({ where: { id }, data: { status: "POSTED", postedById: ctx.userId, postedAt: new Date() } });
    await postCreditNoteJournal(tx, ctx, id);
    const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: cn.invoiceId } });
    const apply = D(inv.total).sub(D(inv.paidAmount));
    const amount = apply.lt(D(cn.total)) ? apply : D(cn.total);
    if (["POSTED", "PARTIALLY_PAID"].includes(inv.status) && amount.gt(0)) await allocateToSalesInvoice(tx, ctx, { invoiceId: inv.id, amount, creditNoteId: id, date: cn.date });
    await audit(tx, ctx, { action: "POST", entity: "CreditNote", entityId: id, summary: `Posted credit note ${cn.number} (${cn.currency} ${D(cn.total).toFixed(2)})${D(cn.total).gt(amount) ? `; ${D(cn.total).sub(amount).toFixed(2)} left as customer credit` : ""}` });
  });
}

export async function cancelCreditNote(ctx: Ctx, id: string) {
  requirePerm(ctx, "finance.sales.manage");
  return withTx(async (tx) => {
    const cn = await tx.creditNote.findUniqueOrThrow({ where: { id } });
    assertStatus(cn.status, ["DRAFT"], "cancel credit note");
    await tx.creditNote.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, { action: "CANCEL", entity: "CreditNote", entityId: id, summary: `Cancelled draft credit note ${cn.number}` });
  });
}

export async function listCreditNotes(ctx: Ctx, a: ListArgs & { status?: string; customerId?: string }) {
  requirePerm(ctx, "finance.view");
  const where: Prisma.CreditNoteWhereInput = {
    ...(a.status ? { status: a.status as never } : {}),
    ...(a.customerId ? { customerId: a.customerId } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { reason: { contains: a.q, mode: "insensitive" } }, { customer: { legalName: { contains: a.q, mode: "insensitive" } } }, { invoice: { number: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.creditNote.findMany({ where, skip, take, include: { customer: { select: { legalName: true } }, invoice: { select: { number: true } } }, orderBy: orderBy(a, ["number", "date", "total", "status"], { date: "desc" }) }),
    prisma.creditNote.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

// ───────── Debit notes ─────────

export const debitNoteSchema = z.object({
  invoiceId: reqStr(40),
  reason: reqStr(1000),
  supplierRef: optStr(60),
  date: optDate,
  purchaseReturnId: optId,
  lines: z.array(z.object({ invoiceLineId: reqStr(40), quantity: posDecimal, unitPrice: decimalStr.optional(), returnLineId: optId })).min(1, "Add at least one line"),
});

async function debitable(tx: Tx, invoiceId: string) {
  const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } });
  const drafts = await tx.debitNoteLine.groupBy({ by: ["invoiceLineId"], where: { debitNote: { invoiceId, status: "DRAFT" } }, _sum: { quantity: true } });
  return inv.lines.map((l) => ({ line: l, open: D(l.quantity).sub(D(l.debitedQty)).sub(D(drafts.find((x) => x.invoiceLineId === l.id)?._sum.quantity)) }));
}

export async function debitableLines(invoiceId: string) {
  return debitable(prisma as unknown as Tx, invoiceId);
}

export async function createDebitNote(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "finance.purchase.manage");
  const d = debitNoteSchema.parse(raw);
  return withTx(async (tx) => {
    await lockRow(tx, "PurchaseInvoice", d.invoiceId);
    const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: d.invoiceId } });
    assertStatus(inv.status, ["POSTED", "PARTIALLY_PAID", "PAID"], "issue a debit note");
    const ret = d.purchaseReturnId ? await tx.purchaseReturn.findUniqueOrThrow({ where: { id: d.purchaseReturnId }, include: { lines: true } }) : null;
    if (ret && (ret.supplierId !== inv.supplierId || ret.purchaseOrderId !== inv.purchaseOrderId)) throw new AppError("The purchase return is for another supplier or purchase order.");
    const open = await debitable(tx, inv.id);
    const used = new Map<string, Dec>();
    const lines = d.lines.map((x) => {
      const o = open.find((y) => y.line.id === x.invoiceLineId);
      if (!o) throw new AppError("Debit note line does not belong to this invoice.");
      const qty = D(x.quantity);
      if (qty.gt(o.open)) throw new AppError(`${o.line.description}: only ${o.open} can still be debited.`);
      if (x.returnLineId) {
        const rl = ret?.lines.find((r) => r.id === x.returnLineId);
        if (!rl || rl.poLineId !== o.line.poLineId) throw new AppError(`${o.line.description}: the return line does not match this invoice line.`);
        const left = D(rl.quantity).sub(D(rl.debitedQty)).sub(used.get(rl.id) ?? ZERO);
        if (qty.gt(left)) throw new AppError(`${o.line.description}: only ${left} returned unit(s) are not yet on a debit note.`);
        used.set(rl.id, (used.get(rl.id) ?? ZERO).add(qty));
      }
      const unitPrice = x.unitPrice !== undefined && x.unitPrice !== "" ? D(x.unitPrice) : D(o.line.unitPrice);
      if (unitPrice.lt(0) || unitPrice.gt(D(o.line.unitPrice))) throw new AppError(`${o.line.description}: the debit price cannot exceed the invoiced price ${D(o.line.unitPrice).toFixed(2)}.`);
      const c = calcLine({ quantity: qty, unitPrice, taxRate: o.line.taxRate });
      return { invoiceLineId: o.line.id, returnLineId: x.returnLineId ?? null, itemId: o.line.itemId, description: o.line.description, quantity: qty, unitPrice, taxRate: o.line.taxRate, lineTotal: c.lineTotal, taxAmount: c.taxAmount };
    });
    const subtotal = lines.reduce((s, l) => s.add(l.lineTotal), ZERO);
    const taxTotal = lines.reduce((s, l) => s.add(l.taxAmount), ZERO);
    if (!subtotal.add(taxTotal).gt(0)) throw new AppError("The debit note total must be greater than zero.");
    const number = await nextNumber(tx, "DEBIT_NOTE");
    const dn = await tx.debitNote.create({
      data: {
        number, date: d.date ?? new Date(), supplierId: inv.supplierId, invoiceId: inv.id, purchaseReturnId: d.purchaseReturnId, supplierRef: d.supplierRef,
        currency: inv.currency, exchangeRate: inv.exchangeRate, reason: d.reason, subtotal, taxTotal, total: subtotal.add(taxTotal), createdById: ctx.userId,
        lines: { create: lines },
      },
    });
    await audit(tx, ctx, { action: "CREATE", entity: "DebitNote", entityId: dn.id, summary: `Prepared debit note ${number} for ${inv.number}: ${d.reason}` });
    return dn;
  });
}

export async function postDebitNote(ctx: Ctx, id: string) {
  requirePerm(ctx, "finance.purchase.manage");
  return withTx(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT id FROM "DebitNote" WHERE id = $1 FOR UPDATE`, id);
    const dn = await tx.debitNote.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    assertStatus(dn.status, ["DRAFT"], "post debit note");
    await lockRow(tx, "PurchaseInvoice", dn.invoiceId);
    for (const l of dn.lines) {
      const il = await tx.purchaseInvoiceLine.findUniqueOrThrow({ where: { id: l.invoiceLineId } });
      if (D(il.debitedQty).add(D(l.quantity)).gt(D(il.quantity))) throw new AppError(`${il.description}: debited quantity would exceed the invoiced quantity.`);
      await tx.purchaseInvoiceLine.update({ where: { id: il.id }, data: { debitedQty: { increment: D(l.quantity) } } });
      if (l.returnLineId) {
        const rl = await tx.purchaseReturnLine.findUniqueOrThrow({ where: { id: l.returnLineId } });
        if (D(rl.debitedQty).add(D(l.quantity)).gt(D(rl.quantity))) throw new AppError(`${l.description}: more than the returned quantity would be debited.`);
        await tx.purchaseReturnLine.update({ where: { id: rl.id }, data: { debitedQty: { increment: D(l.quantity) } } });
      }
    }
    await tx.debitNote.update({ where: { id }, data: { status: "POSTED", postedById: ctx.userId, postedAt: new Date() } });
    await postDebitNoteJournal(tx, ctx, id);
    const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: dn.invoiceId } });
    const apply = D(inv.total).sub(D(inv.paidAmount));
    const amount = round2(apply.lt(D(dn.total)) ? apply : D(dn.total));
    if (["POSTED", "PARTIALLY_PAID"].includes(inv.status) && amount.gt(0)) await allocateToPurchaseInvoice(tx, ctx, { invoiceId: inv.id, amount, debitNoteId: id, date: dn.date });
    await audit(tx, ctx, { action: "POST", entity: "DebitNote", entityId: id, summary: `Posted debit note ${dn.number} (${dn.currency} ${D(dn.total).toFixed(2)})${D(dn.total).gt(amount) ? `; ${D(dn.total).sub(amount).toFixed(2)} left as supplier credit` : ""}` });
  });
}

export async function cancelDebitNote(ctx: Ctx, id: string) {
  requirePerm(ctx, "finance.purchase.manage");
  return withTx(async (tx) => {
    const dn = await tx.debitNote.findUniqueOrThrow({ where: { id } });
    assertStatus(dn.status, ["DRAFT"], "cancel debit note");
    await tx.debitNote.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, { action: "CANCEL", entity: "DebitNote", entityId: id, summary: `Cancelled draft debit note ${dn.number}` });
  });
}

export async function listDebitNotes(ctx: Ctx, a: ListArgs & { status?: string; supplierId?: string }) {
  requirePerm(ctx, "finance.view");
  const where: Prisma.DebitNoteWhereInput = {
    ...(a.status ? { status: a.status as never } : {}),
    ...(a.supplierId ? { supplierId: a.supplierId } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { reason: { contains: a.q, mode: "insensitive" } }, { supplierRef: { contains: a.q, mode: "insensitive" } }, { supplier: { legalName: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.debitNote.findMany({ where, skip, take, include: { supplier: { select: { legalName: true } }, invoice: { select: { number: true, supplierInvoiceNo: true } } }, orderBy: orderBy(a, ["number", "date", "total", "status"], { date: "desc" }) }),
    prisma.debitNote.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}
