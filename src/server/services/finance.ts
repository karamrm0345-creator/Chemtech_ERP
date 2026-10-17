/**
 * Basic receivables / payables tracking (enabled by CompanySettings.financeEnabled).
 * This is document tracking, not a general ledger: invoices and payments are
 * recorded and linked to orders, deliveries and receipts.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, withTx, type Tx } from "../db";
import { requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { nextNumber } from "../numbering";
import { AppError } from "../errors";
import { optDate, optStr, posDecimal, reqStr } from "@/lib/validation";
import { D, ZERO, calcLine, round2 } from "@/lib/decimal";
import { assertStatus, getSettings, lockRow, orderBy, paging, type ListArgs } from "./common";

async function assertFinance(tx: Tx) {
  const s = await getSettings(tx);
  if (!s.financeEnabled) throw new AppError("Finance functions are disabled in company settings.");
}

// ───────── Sales invoices ─────────

export const salesInvoiceSchema = z.object({
  salesOrderId: reqStr(40),
  date: optDate,
  notes: optStr(2000),
  lines: z.array(z.object({ salesOrderLineId: reqStr(40), quantity: posDecimal })).min(1, "Add at least one line"),
});

/**
 * Invoiceable quantity: stocked lines may only be invoiced once delivered;
 * service / free-text lines up to the ordered quantity.
 */
async function invoiceable(tx: Tx, soId: string) {
  const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: soId }, include: { lines: true } });
  const items = new Map((await tx.item.findMany({ where: { id: { in: so.lines.map((l) => l.itemId!).filter(Boolean) } } })).map((i) => [i.id, i]));
  const drafts = await tx.salesInvoiceLine.groupBy({ by: ["salesOrderLineId"], where: { invoice: { salesOrderId: soId, status: "DRAFT" } }, _sum: { quantity: true } });
  return so.lines.map((l) => {
    const it = l.itemId ? items.get(l.itemId) : undefined;
    const stocked = !!it && it.itemType !== "SERVICE" && it.inventoryClass !== "NON_STOCK";
    const cap = stocked ? D(l.deliveredQty) : D(l.quantity);
    const pend = D(drafts.find((x) => x.salesOrderLineId === l.id)?._sum.quantity);
    return { line: l, invoiceable: cap.sub(D(l.invoicedQty)).sub(pend) };
  });
}

export async function invoiceableLines(soId: string) {
  return invoiceable(prisma as unknown as Tx, soId);
}

export async function createSalesInvoice(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "finance.sales.manage");
  const d = salesInvoiceSchema.parse(raw);
  return withTx(async (tx) => {
    await assertFinance(tx);
    await lockRow(tx, "SalesOrder", d.salesOrderId);
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: d.salesOrderId }, include: { customer: true } });
    assertStatus(so.status, ["APPROVED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED"], "invoice");
    const inv = await invoiceable(tx, so.id);
    const lines = d.lines.map((x) => {
      const r = inv.find((i) => i.line.id === x.salesOrderLineId);
      if (!r) throw new AppError("Invoice line does not belong to this order.");
      if (D(x.quantity).gt(r.invoiceable)) throw new AppError(`Line ${r.line.lineNo}: only ${r.invoiceable} can be invoiced (stock items must be delivered first).`);
      const c = calcLine({ quantity: x.quantity, unitPrice: r.line.unitPrice, discountPct: r.line.discountPct, taxRate: r.line.taxRate });
      return {
        salesOrderLineId: r.line.id, itemId: r.line.itemId, description: r.line.description, quantity: D(x.quantity), unitPrice: r.line.unitPrice,
        discountPct: r.line.discountPct, taxRate: r.line.taxRate, lineTotal: c.lineTotal, taxAmount: c.taxAmount,
      };
    });
    const subtotal = lines.reduce((s, l) => s.add(l.lineTotal), ZERO);
    const taxTotal = lines.reduce((s, l) => s.add(l.taxAmount), ZERO);
    const date = d.date ?? new Date();
    const number = await nextNumber(tx, "SALES_INVOICE");
    const invc = await tx.salesInvoice.create({
      data: {
        number, date, dueDate: new Date(date.getTime() + so.customer.paymentTermDays * 86_400_000), customerId: so.customerId, salesOrderId: so.id,
        currency: so.currency, exchangeRate: so.exchangeRate, subtotal, taxTotal, total: subtotal.add(taxTotal), notes: d.notes, createdById: ctx.userId,
        lines: { create: lines },
      },
    });
    await audit(tx, ctx, { action: "CREATE", entity: "SalesInvoice", entityId: invc.id, summary: `Created invoice ${number} for ${so.number}` });
    return invc;
  });
}

export async function postSalesInvoice(ctx: Ctx, id: string) {
  requirePerm(ctx, "finance.sales.manage");
  return withTx(async (tx) => {
    await lockRow(tx, "SalesInvoice", id);
    const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    assertStatus(inv.status, ["DRAFT"], "post invoice");
    for (const l of inv.lines) {
      if (!l.salesOrderLineId) continue;
      const sol = await tx.salesOrderLine.findUniqueOrThrow({ where: { id: l.salesOrderLineId } });
      await tx.salesOrderLine.update({ where: { id: sol.id }, data: { invoicedQty: D(sol.invoicedQty).add(D(l.quantity)) } });
    }
    await tx.salesInvoice.update({ where: { id }, data: { status: "POSTED", postedById: ctx.userId, postedAt: new Date() } });
    await audit(tx, ctx, { action: "POST", entity: "SalesInvoice", entityId: id, summary: `Posted invoice ${inv.number}` });
  });
}

export async function cancelSalesInvoice(ctx: Ctx, id: string) {
  requirePerm(ctx, "finance.sales.manage");
  return withTx(async (tx) => {
    await lockRow(tx, "SalesInvoice", id);
    const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id } });
    assertStatus(inv.status, ["DRAFT"], "cancel invoice (issue a credit note for posted invoices)");
    await tx.salesInvoice.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, { action: "CANCEL", entity: "SalesInvoice", entityId: id, summary: `Cancelled ${inv.number}` });
  });
}

export const paymentSchema = z.object({
  invoiceId: reqStr(40), amount: posDecimal, date: optDate,
  method: z.enum(["BANK_TRANSFER", "CHEQUE", "CASH", "CARD", "OTHER"]).default("BANK_TRANSFER"), reference: optStr(100),
});

export async function recordCustomerPayment(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "finance.sales.manage");
  const d = paymentSchema.parse(raw);
  return withTx(async (tx) => {
    await assertFinance(tx);
    await lockRow(tx, "SalesInvoice", d.invoiceId);
    const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: d.invoiceId } });
    assertStatus(inv.status, ["POSTED", "PARTIALLY_PAID"], "record payment");
    const balance = D(inv.total).sub(D(inv.paidAmount));
    if (D(d.amount).gt(balance)) throw new AppError(`Payment exceeds the outstanding balance (${balance}).`);
    const number = await nextNumber(tx, "CUSTOMER_PAYMENT");
    const p = await tx.customerPayment.create({ data: { number, invoiceId: inv.id, customerId: inv.customerId, amount: D(d.amount), date: d.date ?? new Date(), method: d.method, reference: d.reference, createdById: ctx.userId } });
    const paid = D(inv.paidAmount).add(D(d.amount));
    await tx.salesInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: paid.gte(D(inv.total)) ? "PAID" : "PARTIALLY_PAID" } });
    await audit(tx, ctx, { action: "CREATE", entity: "CustomerPayment", entityId: p.id, summary: `Receipt ${number}: ${d.amount} against ${inv.number}` });
    return p;
  });
}

// ───────── Purchase invoices ─────────

export const purchaseInvoiceSchema = z.object({
  purchaseOrderId: reqStr(40),
  supplierInvoiceNo: reqStr(60),
  date: optDate,
  dueDate: optDate,
  notes: optStr(2000),
  lines: z.array(z.object({ poLineId: reqStr(40), quantity: posDecimal, unitPrice: posDecimal })).min(1),
});

/**
 * Records a supplier invoice with 3-way matching (PO price × received qty).
 * Variances are flagged, not silently accepted.
 */
export async function createPurchaseInvoice(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "finance.purchase.manage");
  const d = purchaseInvoiceSchema.parse(raw);
  return withTx(async (tx) => {
    await assertFinance(tx);
    await lockRow(tx, "PurchaseOrder", d.purchaseOrderId);
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: d.purchaseOrderId }, include: { lines: true, supplier: true } });
    assertStatus(po.status, ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"], "invoice");
    const notes: string[] = [];
    const lines = d.lines.map((x) => {
      const pol = po.lines.find((l) => l.id === x.poLineId);
      if (!pol) throw new AppError("Invoice line does not belong to this purchase order.");
      const netReceived = D(pol.receivedQty).sub(D(pol.returnedQty));
      const open = netReceived.sub(D(pol.invoicedQty));
      if (D(x.quantity).gt(open)) notes.push(`Line ${pol.lineNo}: invoiced ${x.quantity} > received-not-invoiced ${open}`);
      const poNetUnit = D(pol.quantity).gt(0) ? D(pol.lineTotal).div(D(pol.quantity)) : ZERO;
      if (!round2(D(x.unitPrice)).equals(round2(poNetUnit))) notes.push(`Line ${pol.lineNo}: price ${x.unitPrice} vs PO ${round2(poNetUnit)}`);
      const c = calcLine({ quantity: x.quantity, unitPrice: x.unitPrice, taxRate: pol.taxRate });
      return { poLineId: pol.id, itemId: pol.itemId, description: pol.description, quantity: D(x.quantity), unitPrice: D(x.unitPrice), taxRate: pol.taxRate, lineTotal: c.lineTotal, taxAmount: c.taxAmount };
    });
    const subtotal = lines.reduce((s, l) => s.add(l.lineTotal), ZERO);
    const taxTotal = lines.reduce((s, l) => s.add(l.taxAmount), ZERO);
    const date = d.date ?? new Date();
    const number = await nextNumber(tx, "PURCHASE_INVOICE");
    const inv = await tx.purchaseInvoice.create({
      data: {
        number, supplierInvoiceNo: d.supplierInvoiceNo, date, dueDate: d.dueDate ?? new Date(date.getTime() + po.supplier.paymentTermDays * 86_400_000),
        supplierId: po.supplierId, purchaseOrderId: po.id, currency: po.currency, exchangeRate: po.exchangeRate,
        matchStatus: notes.length ? "VARIANCE" : "MATCHED", matchNotes: notes.join("; ") || null,
        subtotal, taxTotal, total: subtotal.add(taxTotal), notes: d.notes, createdById: ctx.userId, lines: { create: lines },
      },
    });
    await audit(tx, ctx, { action: "CREATE", entity: "PurchaseInvoice", entityId: inv.id, summary: `Recorded supplier invoice ${d.supplierInvoiceNo} (${number}) — ${inv.matchStatus}` });
    return inv;
  });
}

export async function postPurchaseInvoice(ctx: Ctx, id: string, varianceJustification?: string) {
  const acceptVariance = !!varianceJustification?.trim();
  requirePerm(ctx, "finance.purchase.manage");
  return withTx(async (tx) => {
    await lockRow(tx, "PurchaseInvoice", id);
    const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    assertStatus(inv.status, ["DRAFT"], "post");
    if (inv.matchStatus === "VARIANCE" && !acceptVariance) throw new AppError(`Matching variance: ${inv.matchNotes}. Confirm acceptance to post.`);
    for (const l of inv.lines) {
      if (!l.poLineId) continue;
      const pol = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: l.poLineId } });
      await tx.purchaseOrderLine.update({ where: { id: pol.id }, data: { invoicedQty: D(pol.invoicedQty).add(D(l.quantity)) } });
    }
    await tx.purchaseInvoice.update({ where: { id }, data: { status: "POSTED", postedById: ctx.userId, postedAt: new Date() } });
    await audit(tx, ctx, { action: "POST", entity: "PurchaseInvoice", entityId: id, summary: `Posted supplier invoice ${inv.number}${inv.matchStatus === "VARIANCE" ? ` with accepted variance — ${varianceJustification}` : ""}` });
  });
}

export async function recordSupplierPayment(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "finance.purchase.manage");
  const d = paymentSchema.parse(raw);
  return withTx(async (tx) => {
    await assertFinance(tx);
    await lockRow(tx, "PurchaseInvoice", d.invoiceId);
    const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: d.invoiceId } });
    assertStatus(inv.status, ["POSTED", "PARTIALLY_PAID"], "record payment");
    const balance = D(inv.total).sub(D(inv.paidAmount));
    if (D(d.amount).gt(balance)) throw new AppError(`Payment exceeds the outstanding balance (${balance}).`);
    const number = await nextNumber(tx, "SUPPLIER_PAYMENT");
    const p = await tx.supplierPayment.create({ data: { number, invoiceId: inv.id, supplierId: inv.supplierId, amount: D(d.amount), date: d.date ?? new Date(), method: d.method, reference: d.reference, createdById: ctx.userId } });
    const paid = D(inv.paidAmount).add(D(d.amount));
    await tx.purchaseInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: paid.gte(D(inv.total)) ? "PAID" : "PARTIALLY_PAID" } });
    await audit(tx, ctx, { action: "CREATE", entity: "SupplierPayment", entityId: p.id, summary: `Payment ${number}: ${d.amount} against ${inv.number}` });
    return p;
  });
}

export async function listSalesInvoices(ctx: Ctx, a: ListArgs & { status?: string; overdue?: boolean; customerId?: string }) {
  requirePerm(ctx, "finance.view");
  const where: Prisma.SalesInvoiceWhereInput = {
    ...(a.status === "OPEN" ? { status: { in: ["POSTED", "PARTIALLY_PAID"] } } : a.status ? { status: a.status as never } : {}),
    ...(a.overdue ? { status: { in: ["POSTED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } } : {}),
    ...(a.customerId ? { customerId: a.customerId } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { customer: { legalName: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.salesInvoice.findMany({ where, skip, take, include: { customer: { select: { legalName: true } }, salesOrder: { select: { number: true } } }, orderBy: orderBy(a, ["number", "date", "dueDate", "total", "status"], { date: "desc" }) }),
    prisma.salesInvoice.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function listPurchaseInvoices(ctx: Ctx, a: ListArgs & { status?: string; supplierId?: string }) {
  requirePerm(ctx, "finance.view");
  const where: Prisma.PurchaseInvoiceWhereInput = {
    ...(a.status === "OPEN" ? { status: { in: ["POSTED", "PARTIALLY_PAID"] } } : a.status ? { status: a.status as never } : {}),
    ...(a.supplierId ? { supplierId: a.supplierId } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { supplierInvoiceNo: { contains: a.q, mode: "insensitive" } }, { supplier: { legalName: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.purchaseInvoice.findMany({ where, skip, take, include: { supplier: { select: { legalName: true } }, purchaseOrder: { select: { number: true } } }, orderBy: orderBy(a, ["number", "date", "dueDate", "total", "status"], { date: "desc" }) }),
    prisma.purchaseInvoice.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}
