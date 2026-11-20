/**
 * Customer receipts and supplier payments with allocation. A payment is posted
 * to the ledger in full against the party; allocations then settle invoices.
 * Anything not allocated stays on the party's account as an advance / credit
 * and can be allocated later. When an invoice and the document settling it
 * carry different exchange rates, the allocation books the realised exchange
 * difference.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, withTx, type Tx } from "../db";
import { requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { nextNumber } from "../numbering";
import { AppError } from "../errors";
import { decimalStr, optDate, optId, optStr, posDecimal } from "@/lib/validation";
import { D, ZERO, round2, type Dec } from "@/lib/decimal";
import { accountId as postingAccount, postJournal } from "../accounting/ledger";
import { postCustomerPaymentJournal, postSupplierPaymentJournal } from "../accounting/postings";
import { getSettings, orderBy, paging, rateFor, type ListArgs } from "./common";

const OPEN = ["POSTED", "PARTIALLY_PAID"] as const;

async function assertFinance(tx: Tx) {
  if (!(await getSettings(tx)).financeEnabled) throw new AppError("Finance functions are disabled in company settings.");
}

const lock = (tx: Tx, table: "CustomerPayment" | "SupplierPayment" | "CreditNote" | "DebitNote" | "SalesInvoice" | "PurchaseInvoice", id: string) =>
  tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);

export const paymentSchema = z.object({
  invoiceId: optId, // single-invoice receipt from the invoice page
  customerId: optId,
  supplierId: optId,
  amount: posDecimal,
  date: optDate,
  method: z.enum(["BANK_TRANSFER", "CHEQUE", "CASH", "CARD", "OTHER"]).default("BANK_TRANSFER"),
  reference: optStr(100),
  accountId: optId,
  currency: optStr(3),
  exchangeRate: decimalStr.optional(),
  whtRate: decimalStr.optional(), // supplier payments: % withheld (defaults to the supplier's rate)
  allocations: z.array(z.object({ invoiceId: z.string().min(1).max(40), amount: posDecimal })).default([]),
});

/** The bank / cash account a payment goes through: the one chosen, or the default for its method. */
async function paymentAccount(tx: Tx, accountId: string | undefined, method: string) {
  if (!accountId) return postingAccount(tx, method === "CASH" ? "CASH" : "BANK");
  const a = await tx.account.findUnique({ where: { id: accountId } });
  if (!a || !a.isBank || !a.active || a.isGroup) throw new AppError("Choose an active bank or cash account.");
  return a.id;
}

async function paymentRate(tx: Tx, currency: string, given?: string) {
  const s = await getSettings(tx);
  if (currency === s.baseCurrency) return D(1);
  if (given && D(given).gt(0)) return D(given);
  return rateFor(tx, currency);
}

/** Realised exchange difference when an invoice is settled at a different rate than it was booked at. */
async function postAllocationFx(tx: Tx, ctx: Ctx, a: {
  side: "CUSTOMER" | "SUPPLIER"; allocationId: string; no: string; partyId: string; amount: Dec; invoiceRate: Dec; settleRate: Dec; date: Date;
}) {
  const diff = round2(a.amount.mul(a.invoiceRate)).sub(round2(a.amount.mul(a.settleRate)));
  if (diff.isZero()) return;
  // Customer: receivable booked at the invoice rate, cleared at the receipt rate → the gap is a loss (or gain).
  const lines = a.side === "CUSTOMER"
    ? [{ account: "AR" as const, credit: diff, partyType: "CUSTOMER" as const, partyId: a.partyId }, { account: "EXCHANGE_DIFF" as const, debit: diff }]
    : [{ account: "AP" as const, debit: diff, partyType: "SUPPLIER" as const, partyId: a.partyId }, { account: "EXCHANGE_DIFF" as const, credit: diff }];
  await postJournal(tx, ctx, {
    date: a.date, type: "EXCHANGE_DIFFERENCE", memo: `Exchange difference on ${a.no}`,
    source: { type: a.side === "CUSTOMER" ? "CustomerAllocation" : "SupplierAllocation", id: a.allocationId, no: a.no }, lines,
  });
}

// ───────── Customer side ─────────

/** Applies part of a receipt or credit note to a posted sales invoice of the same customer and currency. */
export async function allocateToSalesInvoice(tx: Tx, ctx: Ctx, a: { invoiceId: string; amount: Dec; date?: Date; paymentId?: string; creditNoteId?: string }) {
  const amount = round2(a.amount);
  if (!amount.gt(0)) throw new AppError("Allocation amount must be greater than zero.");
  await lock(tx, "SalesInvoice", a.invoiceId);
  const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
  if (!(OPEN as readonly string[]).includes(inv.status)) throw new AppError(`${inv.number} has no open balance.`);
  const balance = D(inv.total).sub(D(inv.paidAmount));
  if (amount.gt(balance)) throw new AppError(`${inv.number}: ${amount.toFixed(2)} exceeds the open balance ${balance.toFixed(2)}.`);
  let src: { customerId: string; currency: string; rate: Dec; open: Dec; no: string };
  if (a.paymentId) {
    await lock(tx, "CustomerPayment", a.paymentId);
    const p = await tx.customerPayment.findUniqueOrThrow({ where: { id: a.paymentId } });
    src = { customerId: p.customerId, currency: p.currency, rate: D(p.exchangeRate), open: D(p.amount).sub(D(p.allocatedAmount)), no: p.number };
  } else if (a.creditNoteId) {
    await lock(tx, "CreditNote", a.creditNoteId);
    const c = await tx.creditNote.findUniqueOrThrow({ where: { id: a.creditNoteId } });
    if (c.status !== "POSTED") throw new AppError(`${c.number} is not posted.`);
    src = { customerId: c.customerId, currency: c.currency, rate: D(c.exchangeRate), open: D(c.total).sub(D(c.allocatedAmount)), no: c.number };
  } else throw new AppError("Nothing to allocate from.");
  if (src.customerId !== inv.customerId) throw new AppError(`${src.no} belongs to a different customer than ${inv.number}.`);
  if (src.currency !== inv.currency) throw new AppError(`${src.no} is in ${src.currency}; ${inv.number} is in ${inv.currency}.`);
  if (amount.gt(src.open)) throw new AppError(`${src.no} has only ${src.open.toFixed(2)} ${src.currency} left to allocate.`);
  const date = a.date ?? new Date();
  const alloc = await tx.customerAllocation.create({
    data: { customerId: inv.customerId, invoiceId: inv.id, paymentId: a.paymentId, creditNoteId: a.creditNoteId, amount, date, createdById: ctx.userId },
  });
  if (a.paymentId) await tx.customerPayment.update({ where: { id: a.paymentId }, data: { allocatedAmount: { increment: amount } } });
  else await tx.creditNote.update({ where: { id: a.creditNoteId }, data: { allocatedAmount: { increment: amount } } });
  const paid = D(inv.paidAmount).add(amount);
  await tx.salesInvoice.update({
    where: { id: inv.id },
    data: { paidAmount: paid, ...(a.creditNoteId ? { creditedAmount: D(inv.creditedAmount).add(amount) } : {}), status: paid.gte(D(inv.total)) ? "PAID" : "PARTIALLY_PAID" },
  });
  await postAllocationFx(tx, ctx, { side: "CUSTOMER", allocationId: alloc.id, no: `${src.no} → ${inv.number}`, partyId: inv.customerId, amount, invoiceRate: D(inv.exchangeRate), settleRate: src.rate, date });
  return alloc;
}

export async function recordCustomerPayment(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "finance.sales.manage");
  const d = paymentSchema.parse(raw);
  return withTx(async (tx) => {
    await assertFinance(tx);
    let customerId = d.customerId, currency = d.currency, rate: Dec;
    let allocations = d.allocations.map((x) => ({ invoiceId: x.invoiceId, amount: D(x.amount) }));
    if (d.invoiceId && !allocations.length) {
      await lock(tx, "SalesInvoice", d.invoiceId);
      const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: d.invoiceId } });
      if (!(OPEN as readonly string[]).includes(inv.status)) throw new AppError(`Cannot record payment: document status is ${inv.status.replace(/_/g, " ").toLowerCase()}.`);
      const balance = D(inv.total).sub(D(inv.paidAmount));
      if (D(d.amount).gt(balance)) throw new AppError(`Payment exceeds the outstanding balance (${balance}).`);
      customerId = inv.customerId; currency = inv.currency; rate = D(inv.exchangeRate);
      allocations = [{ invoiceId: inv.id, amount: D(d.amount) }];
    } else {
      if (!customerId) throw new AppError("Choose the customer.");
      const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      currency = currency || c.currency;
      rate = await paymentRate(tx, currency, d.exchangeRate);
    }
    const allocated = allocations.reduce((s, x) => s.add(x.amount), ZERO);
    if (allocated.gt(D(d.amount))) throw new AppError(`Allocations (${allocated.toFixed(2)}) exceed the amount received (${D(d.amount).toFixed(2)}).`);
    const accountId = await paymentAccount(tx, d.accountId, d.method);
    const number = await nextNumber(tx, "CUSTOMER_PAYMENT");
    const date = d.date ?? new Date();
    const p = await tx.customerPayment.create({
      data: {
        number, customerId: customerId!, invoiceId: allocations.length === 1 ? allocations[0].invoiceId : null, amount: D(d.amount), currency: currency!, exchangeRate: rate!,
        date, method: d.method, reference: d.reference, accountId, createdById: ctx.userId,
      },
    });
    await postCustomerPaymentJournal(tx, ctx, p.id);
    for (const x of allocations) await allocateToSalesInvoice(tx, ctx, { invoiceId: x.invoiceId, amount: x.amount, paymentId: p.id, date });
    const advance = D(d.amount).sub(allocated);
    await audit(tx, ctx, { action: "CREATE", entity: "CustomerPayment", entityId: p.id, summary: `Receipt ${number}: ${currency} ${D(d.amount).toFixed(2)}${allocations.length ? ` allocated to ${allocations.length} invoice(s)` : ""}${advance.gt(0) ? `, ${advance.toFixed(2)} on account` : ""}` });
    return p;
  });
}

/** Later allocation of a receipt (advance) or credit note to an open invoice. */
export async function allocateCustomerCredit(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "finance.sales.manage");
  const d = z.object({ paymentId: optId, creditNoteId: optId, invoiceId: z.string().min(1).max(40), amount: posDecimal, date: optDate }).parse(raw);
  return withTx(async (tx) => {
    await assertFinance(tx);
    const a = await allocateToSalesInvoice(tx, ctx, { invoiceId: d.invoiceId, amount: D(d.amount), paymentId: d.paymentId, creditNoteId: d.creditNoteId, date: d.date });
    await audit(tx, ctx, { action: "ALLOCATE", entity: d.paymentId ? "CustomerPayment" : "CreditNote", entityId: d.paymentId ?? d.creditNoteId, summary: `Allocated ${D(d.amount).toFixed(2)} to invoice` });
    return a;
  });
}

// ───────── Supplier side ─────────

export async function allocateToPurchaseInvoice(tx: Tx, ctx: Ctx, a: { invoiceId: string; amount: Dec; date?: Date; paymentId?: string; debitNoteId?: string }) {
  const amount = round2(a.amount);
  if (!amount.gt(0)) throw new AppError("Allocation amount must be greater than zero.");
  await lock(tx, "PurchaseInvoice", a.invoiceId);
  const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
  if (!(OPEN as readonly string[]).includes(inv.status)) throw new AppError(`${inv.number} has no open balance.`);
  const balance = D(inv.total).sub(D(inv.paidAmount));
  if (amount.gt(balance)) throw new AppError(`${inv.number}: ${amount.toFixed(2)} exceeds the open balance ${balance.toFixed(2)}.`);
  let src: { supplierId: string; currency: string; rate: Dec; open: Dec; no: string };
  if (a.paymentId) {
    await lock(tx, "SupplierPayment", a.paymentId);
    const p = await tx.supplierPayment.findUniqueOrThrow({ where: { id: a.paymentId } });
    src = { supplierId: p.supplierId, currency: p.currency, rate: D(p.exchangeRate), open: D(p.amount).sub(D(p.allocatedAmount)), no: p.number };
  } else if (a.debitNoteId) {
    await lock(tx, "DebitNote", a.debitNoteId);
    const n = await tx.debitNote.findUniqueOrThrow({ where: { id: a.debitNoteId } });
    if (n.status !== "POSTED") throw new AppError(`${n.number} is not posted.`);
    src = { supplierId: n.supplierId, currency: n.currency, rate: D(n.exchangeRate), open: D(n.total).sub(D(n.allocatedAmount)), no: n.number };
  } else throw new AppError("Nothing to allocate from.");
  if (src.supplierId !== inv.supplierId) throw new AppError(`${src.no} belongs to a different supplier than ${inv.number}.`);
  if (src.currency !== inv.currency) throw new AppError(`${src.no} is in ${src.currency}; ${inv.number} is in ${inv.currency}.`);
  if (amount.gt(src.open)) throw new AppError(`${src.no} has only ${src.open.toFixed(2)} ${src.currency} left to allocate.`);
  const date = a.date ?? new Date();
  const alloc = await tx.supplierAllocation.create({
    data: { supplierId: inv.supplierId, invoiceId: inv.id, paymentId: a.paymentId, debitNoteId: a.debitNoteId, amount, date, createdById: ctx.userId },
  });
  if (a.paymentId) await tx.supplierPayment.update({ where: { id: a.paymentId }, data: { allocatedAmount: { increment: amount } } });
  else await tx.debitNote.update({ where: { id: a.debitNoteId }, data: { allocatedAmount: { increment: amount } } });
  const paid = D(inv.paidAmount).add(amount);
  await tx.purchaseInvoice.update({
    where: { id: inv.id },
    data: { paidAmount: paid, ...(a.debitNoteId ? { debitedAmount: D(inv.debitedAmount).add(amount) } : {}), status: paid.gte(D(inv.total)) ? "PAID" : "PARTIALLY_PAID" },
  });
  await postAllocationFx(tx, ctx, { side: "SUPPLIER", allocationId: alloc.id, no: `${src.no} → ${inv.number}`, partyId: inv.supplierId, amount, invoiceRate: D(inv.exchangeRate), settleRate: src.rate, date });
  return alloc;
}

export async function recordSupplierPayment(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "finance.purchase.manage");
  const d = paymentSchema.parse(raw);
  return withTx(async (tx) => {
    await assertFinance(tx);
    let supplierId = d.supplierId, currency = d.currency, rate: Dec;
    let allocations = d.allocations.map((x) => ({ invoiceId: x.invoiceId, amount: D(x.amount) }));
    if (d.invoiceId && !allocations.length) {
      await lock(tx, "PurchaseInvoice", d.invoiceId);
      const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: d.invoiceId } });
      if (!(OPEN as readonly string[]).includes(inv.status)) throw new AppError(`Cannot record payment: document status is ${inv.status.replace(/_/g, " ").toLowerCase()}.`);
      const balance = D(inv.total).sub(D(inv.paidAmount));
      if (D(d.amount).gt(balance)) throw new AppError(`Payment exceeds the outstanding balance (${balance}).`);
      supplierId = inv.supplierId; currency = inv.currency; rate = D(inv.exchangeRate);
      allocations = [{ invoiceId: inv.id, amount: D(d.amount) }];
    } else {
      if (!supplierId) throw new AppError("Choose the supplier.");
      const s = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId } });
      currency = currency || s.currency;
      rate = await paymentRate(tx, currency, d.exchangeRate);
    }
    const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId! } });
    const whtRate = d.whtRate !== undefined && d.whtRate !== "" ? D(d.whtRate) : D(supplier.withholdingRate);
    if (whtRate.lt(0) || whtRate.gt(100)) throw new AppError("Withholding rate must be between 0 and 100.");
    const whtAmount = round2(D(d.amount).mul(whtRate).div(100));
    const allocated = allocations.reduce((s, x) => s.add(x.amount), ZERO);
    if (allocated.gt(D(d.amount))) throw new AppError(`Allocations (${allocated.toFixed(2)}) exceed the payment amount (${D(d.amount).toFixed(2)}).`);
    const accountId = await paymentAccount(tx, d.accountId, d.method);
    const number = await nextNumber(tx, "SUPPLIER_PAYMENT");
    const date = d.date ?? new Date();
    const p = await tx.supplierPayment.create({
      data: {
        number, supplierId: supplierId!, invoiceId: allocations.length === 1 ? allocations[0].invoiceId : null, amount: D(d.amount), currency: currency!, exchangeRate: rate!,
        whtRate, whtAmount, date, method: d.method, reference: d.reference, accountId, createdById: ctx.userId,
      },
    });
    await postSupplierPaymentJournal(tx, ctx, p.id);
    for (const x of allocations) await allocateToPurchaseInvoice(tx, ctx, { invoiceId: x.invoiceId, amount: x.amount, paymentId: p.id, date });
    await audit(tx, ctx, { action: "CREATE", entity: "SupplierPayment", entityId: p.id, summary: `Payment ${number}: ${currency} ${D(d.amount).toFixed(2)}${whtAmount.gt(0) ? ` (withholding ${whtAmount.toFixed(2)})` : ""}${allocations.length ? ` allocated to ${allocations.length} invoice(s)` : ""}` });
    return p;
  });
}

export async function allocateSupplierCredit(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "finance.purchase.manage");
  const d = z.object({ paymentId: optId, debitNoteId: optId, invoiceId: z.string().min(1).max(40), amount: posDecimal, date: optDate }).parse(raw);
  return withTx(async (tx) => {
    await assertFinance(tx);
    const a = await allocateToPurchaseInvoice(tx, ctx, { invoiceId: d.invoiceId, amount: D(d.amount), paymentId: d.paymentId, debitNoteId: d.debitNoteId, date: d.date });
    await audit(tx, ctx, { action: "ALLOCATE", entity: d.paymentId ? "SupplierPayment" : "DebitNote", entityId: d.paymentId ?? d.debitNoteId, summary: `Allocated ${D(d.amount).toFixed(2)} to supplier invoice` });
    return a;
  });
}

// ───────── Queries ─────────

export async function listCustomerPayments(ctx: Ctx, a: ListArgs & { customerId?: string; unallocated?: boolean; from?: Date; to?: Date }) {
  requirePerm(ctx, "finance.view");
  const where: Prisma.CustomerPaymentWhereInput = {
    ...(a.customerId ? { customerId: a.customerId } : {}),
    ...(a.from || a.to ? { date: { ...(a.from ? { gte: a.from } : {}), ...(a.to ? { lte: a.to } : {}) } } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { reference: { contains: a.q, mode: "insensitive" } }, { customer: { legalName: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  if (a.unallocated) {
    const ids = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "CustomerPayment" WHERE amount > "allocatedAmount"`;
    where.id = { in: ids.map((r) => r.id) };
  }
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.customerPayment.findMany({ where, skip, take, include: { customer: { select: { legalName: true } }, account: { select: { code: true, name: true } } }, orderBy: orderBy(a, ["number", "date", "amount"], { date: "desc" }) }),
    prisma.customerPayment.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function listSupplierPayments(ctx: Ctx, a: ListArgs & { supplierId?: string; unallocated?: boolean; from?: Date; to?: Date }) {
  requirePerm(ctx, "finance.view");
  const where: Prisma.SupplierPaymentWhereInput = {
    ...(a.supplierId ? { supplierId: a.supplierId } : {}),
    ...(a.from || a.to ? { date: { ...(a.from ? { gte: a.from } : {}), ...(a.to ? { lte: a.to } : {}) } } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { reference: { contains: a.q, mode: "insensitive" } }, { supplier: { legalName: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  if (a.unallocated) {
    const ids = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "SupplierPayment" WHERE amount > "allocatedAmount"`;
    where.id = { in: ids.map((r) => r.id) };
  }
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.supplierPayment.findMany({ where, skip, take, include: { supplier: { select: { legalName: true } }, account: { select: { code: true, name: true } } }, orderBy: orderBy(a, ["number", "date", "amount"], { date: "desc" }) }),
    prisma.supplierPayment.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

/** Open invoices of a party in a currency, oldest first (for allocation screens). */
export async function openSalesInvoices(customerId: string, currency?: string) {
  const rows = await prisma.salesInvoice.findMany({ where: { customerId, status: { in: [...OPEN] }, ...(currency ? { currency } : {}) }, orderBy: [{ dueDate: "asc" }, { number: "asc" }] });
  return rows.map((i) => ({ ...i, balance: D(i.total).sub(D(i.paidAmount)) }));
}

export async function openPurchaseInvoices(supplierId: string, currency?: string) {
  const rows = await prisma.purchaseInvoice.findMany({ where: { supplierId, status: { in: [...OPEN] }, ...(currency ? { currency } : {}) }, orderBy: [{ dueDate: "asc" }, { number: "asc" }] });
  return rows.map((i) => ({ ...i, balance: D(i.total).sub(D(i.paidAmount)) }));
}

/** Unallocated receipts and credit notes of a customer (credits that can settle invoices). */
export async function customerCredits(customerId: string) {
  const [pays, notes] = await Promise.all([
    prisma.customerPayment.findMany({ where: { customerId }, orderBy: { date: "asc" } }),
    prisma.creditNote.findMany({ where: { customerId, status: "POSTED" }, orderBy: { date: "asc" } }),
  ]);
  return [
    ...pays.filter((p) => D(p.amount).gt(D(p.allocatedAmount))).map((p) => ({ kind: "payment" as const, id: p.id, number: p.number, date: p.date, currency: p.currency, open: D(p.amount).sub(D(p.allocatedAmount)) })),
    ...notes.filter((n) => D(n.total).gt(D(n.allocatedAmount))).map((n) => ({ kind: "creditNote" as const, id: n.id, number: n.number, date: n.date, currency: n.currency, open: D(n.total).sub(D(n.allocatedAmount)) })),
  ];
}

export async function supplierCredits(supplierId: string) {
  const [pays, notes] = await Promise.all([
    prisma.supplierPayment.findMany({ where: { supplierId }, orderBy: { date: "asc" } }),
    prisma.debitNote.findMany({ where: { supplierId, status: "POSTED" }, orderBy: { date: "asc" } }),
  ]);
  return [
    ...pays.filter((p) => D(p.amount).gt(D(p.allocatedAmount))).map((p) => ({ kind: "payment" as const, id: p.id, number: p.number, date: p.date, currency: p.currency, open: D(p.amount).sub(D(p.allocatedAmount)) })),
    ...notes.filter((n) => D(n.total).gt(D(n.allocatedAmount))).map((n) => ({ kind: "debitNote" as const, id: n.id, number: n.number, date: n.date, currency: n.currency, open: D(n.total).sub(D(n.allocatedAmount)) })),
  ];
}

// ───────── Refunds ─────────

export const refundSchema = z.object({
  side: z.enum(["CUSTOMER", "SUPPLIER"]),
  paymentId: optId,
  creditNoteId: optId,
  debitNoteId: optId,
  amount: posDecimal,
  date: optDate,
  method: z.enum(["BANK_TRANSFER", "CHEQUE", "CASH", "CARD", "OTHER"]).default("BANK_TRANSFER"),
  accountId: optId,
  reference: optStr(100),
  reason: z.string().trim().min(1, "Required").max(500),
});

/**
 * Pays back unused customer credit (an unallocated receipt or credit note), or
 * records money a supplier returns (unallocated payment or debit note). The
 * refunded amount is used up on the source document like an allocation.
 */
export async function recordRefund(ctx: Ctx, raw: unknown) {
  const d = refundSchema.parse(raw);
  requirePerm(ctx, d.side === "CUSTOMER" ? "finance.sales.manage" : "finance.purchase.manage");
  const sources = [d.paymentId, d.creditNoteId, d.debitNoteId].filter(Boolean);
  if (sources.length !== 1) throw new AppError("Choose the receipt, payment or note being refunded.");
  if (d.side === "CUSTOMER" && d.debitNoteId) throw new AppError("A customer refund comes from a receipt or credit note.");
  if (d.side === "SUPPLIER" && d.creditNoteId) throw new AppError("A supplier refund comes from a payment or debit note.");
  return withTx(async (tx) => {
    await assertFinance(tx);
    let src: { partyId: string; currency: string; rate: Dec; open: Dec; no: string };
    if (d.paymentId && d.side === "CUSTOMER") {
      await lock(tx, "CustomerPayment", d.paymentId);
      const p = await tx.customerPayment.findUniqueOrThrow({ where: { id: d.paymentId } });
      src = { partyId: p.customerId, currency: p.currency, rate: D(p.exchangeRate), open: D(p.amount).sub(D(p.allocatedAmount)), no: p.number };
    } else if (d.paymentId) {
      await lock(tx, "SupplierPayment", d.paymentId);
      const p = await tx.supplierPayment.findUniqueOrThrow({ where: { id: d.paymentId } });
      src = { partyId: p.supplierId, currency: p.currency, rate: D(p.exchangeRate), open: D(p.amount).sub(D(p.allocatedAmount)), no: p.number };
    } else if (d.creditNoteId) {
      await lock(tx, "CreditNote", d.creditNoteId);
      const n = await tx.creditNote.findUniqueOrThrow({ where: { id: d.creditNoteId } });
      if (n.status !== "POSTED") throw new AppError(`${n.number} is not posted.`);
      src = { partyId: n.customerId, currency: n.currency, rate: D(n.exchangeRate), open: D(n.total).sub(D(n.allocatedAmount)), no: n.number };
    } else {
      await lock(tx, "DebitNote", d.debitNoteId!);
      const n = await tx.debitNote.findUniqueOrThrow({ where: { id: d.debitNoteId } });
      if (n.status !== "POSTED") throw new AppError(`${n.number} is not posted.`);
      src = { partyId: n.supplierId, currency: n.currency, rate: D(n.exchangeRate), open: D(n.total).sub(D(n.allocatedAmount)), no: n.number };
    }
    const amount = round2(D(d.amount));
    if (amount.gt(src.open)) throw new AppError(`${src.no} has only ${src.open.toFixed(2)} ${src.currency} unallocated.`);
    const accountId = await paymentAccount(tx, d.accountId, d.method);
    const number = await nextNumber(tx, "REFUND");
    const date = d.date ?? new Date();
    const r = await tx.refund.create({
      data: {
        number, side: d.side, customerId: d.side === "CUSTOMER" ? src.partyId : null, supplierId: d.side === "SUPPLIER" ? src.partyId : null,
        paymentId: d.paymentId, creditNoteId: d.creditNoteId, debitNoteId: d.debitNoteId, amount, currency: src.currency, exchangeRate: src.rate,
        date, accountId, method: d.method, reference: d.reference, reason: d.reason, createdById: ctx.userId,
      },
    });
    if (d.paymentId && d.side === "CUSTOMER") await tx.customerPayment.update({ where: { id: d.paymentId }, data: { allocatedAmount: { increment: amount } } });
    else if (d.paymentId) await tx.supplierPayment.update({ where: { id: d.paymentId }, data: { allocatedAmount: { increment: amount } } });
    else if (d.creditNoteId) await tx.creditNote.update({ where: { id: d.creditNoteId }, data: { allocatedAmount: { increment: amount } } });
    else await tx.debitNote.update({ where: { id: d.debitNoteId! }, data: { allocatedAmount: { increment: amount } } });
    const base = amount.mul(src.rate);
    await postJournal(tx, ctx, {
      date, type: "REFUND", memo: `Refund ${number} of ${src.no}: ${d.reason}`, reference: d.reference,
      source: { type: "Refund", id: r.id, no: number },
      lines: d.side === "CUSTOMER"
        ? [{ account: "AR", debit: base, partyType: "CUSTOMER", partyId: src.partyId }, { account: { id: accountId }, credit: base }]
        : [{ account: { id: accountId }, debit: base }, { account: "AP", credit: base, partyType: "SUPPLIER", partyId: src.partyId }],
    });
    await audit(tx, ctx, { action: "CREATE", entity: "Refund", entityId: r.id, summary: `Refund ${number}: ${src.currency} ${amount.toFixed(2)} ${d.side === "CUSTOMER" ? "paid to customer" : "received from supplier"} from ${src.no}` });
    return r;
  });
}

export async function refundsFor(source: { paymentId?: string; creditNoteId?: string; debitNoteId?: string }) {
  return prisma.refund.findMany({ where: source, orderBy: { date: "asc" } });
}
