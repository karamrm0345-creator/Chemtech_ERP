/**
 * Posts general-ledger journals for documents that were posted before the
 * ledger existed. Idempotent: documents that already have a journal are
 * skipped, so it is safe to run on every start-up.
 */
import type { Ctx } from "../context";
import { prisma, withTx } from "../db";
import { accountId, reverseJournal } from "./ledger";
import {
  postCustomerPaymentJournal, postPurchaseInvoiceJournal, postSalesInvoiceJournal, postStockJournal, postSupplierPaymentJournal,
} from "./postings";

const ctxOf = (userId: string): Ctx => ({ userId, userName: "Ledger backfill", roleId: "", roleCode: "SYSTEM", permissions: new Set() });

async function journaled(sourceType: string, kind = "POST") {
  const rows = await prisma.journalEntry.findMany({ where: { sourceType, sourceKind: kind }, select: { sourceId: true } });
  return new Set(rows.map((r) => r.sourceId));
}

export async function backfillLedger(log: (m: string) => void = () => {}) {
  if (!(await prisma.accountDefault.count())) throw new Error("Chart of accounts is not set up. Run the base seed first.");
  const counts: Record<string, number> = {};

  const stockDocs: { type: string; label: string; rows: { id: string; number: string; userId: string; date: Date }[] }[] = [
    { type: "GoodsReceipt", label: "Goods receipts", rows: (await prisma.goodsReceipt.findMany({ where: { status: "POSTED" } })).map((d) => ({ id: d.id, number: d.number, userId: d.postedById ?? d.createdById, date: d.date })) },
    { type: "PurchaseReturn", label: "Purchase returns", rows: (await prisma.purchaseReturn.findMany({ where: { status: "POSTED" } })).map((d) => ({ id: d.id, number: d.number, userId: d.postedById ?? d.createdById, date: d.date })) },
    { type: "DeliveryOrder", label: "Deliveries", rows: (await prisma.deliveryOrder.findMany({ where: { status: "POSTED" } })).map((d) => ({ id: d.id, number: d.number, userId: d.postedById ?? d.createdById, date: d.date })) },
    { type: "StockDocument", label: "Stock documents", rows: (await prisma.stockDocument.findMany({ where: { status: { in: ["POSTED", "REVERSED"] } } })).map((d) => ({ id: d.id, number: d.number, userId: d.postedById ?? d.createdById, date: d.date })) },
    { type: "StockCount", label: "Stock counts", rows: (await prisma.stockCount.findMany({ where: { status: "POSTED" } })).map((d) => ({ id: d.id, number: d.number, userId: d.postedById ?? d.createdById, date: d.postedAt ?? d.createdAt })) },
  ];
  for (const g of stockDocs) {
    const done = await journaled(g.type);
    let n = 0;
    for (const d of g.rows.filter((r) => !done.has(r.id)).sort((a, b) => a.date.getTime() - b.date.getTime())) {
      await withTx(async (tx) => { if (await postStockJournal(tx, ctxOf(d.userId), { type: g.type, id: d.id, no: d.number })) n++; });
    }
    if (n) { counts[g.label] = n; log(`${g.label}: ${n} journal(s) posted`); }
  }

  // Stock documents reversed before the ledger existed: reverse their journal on the reversal date.
  const reversedDone = await journaled("StockDocument", "POST-REVERSE");
  for (const d of await prisma.stockDocument.findMany({ where: { status: "REVERSED" } })) {
    if (reversedDone.has(d.id)) continue;
    const j = await prisma.journalEntry.findUnique({ where: { sourceType_sourceId_sourceKind: { sourceType: "StockDocument", sourceId: d.id, sourceKind: "POST" } } });
    if (!j) continue;
    const rev = await prisma.inventoryTransaction.findFirst({ where: { refDocType: "StockDocument", refDocId: d.id, type: "REVERSAL" }, orderBy: { seq: "asc" } });
    await withTx((tx) => reverseJournal(tx, ctxOf(d.reversedById ?? d.createdById), j.id, { date: rev?.txnDate, memo: `Reversal of ${d.number}` }));
    counts["Stock reversals"] = (counts["Stock reversals"] ?? 0) + 1;
  }

  const salesInv = await journaled("SalesInvoice");
  for (const i of await prisma.salesInvoice.findMany({ where: { status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] } }, orderBy: { date: "asc" } })) {
    if (salesInv.has(i.id)) continue;
    await withTx((tx) => postSalesInvoiceJournal(tx, ctxOf(i.postedById ?? i.createdById), i.id));
    counts["Sales invoices"] = (counts["Sales invoices"] ?? 0) + 1;
  }
  const purInv = await journaled("PurchaseInvoice");
  for (const i of await prisma.purchaseInvoice.findMany({ where: { status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] } }, orderBy: { date: "asc" } })) {
    if (purInv.has(i.id)) continue;
    await withTx((tx) => postPurchaseInvoiceJournal(tx, ctxOf(i.postedById ?? i.createdById), i.id));
    counts["Supplier invoices"] = (counts["Supplier invoices"] ?? 0) + 1;
  }
  const custPay = await journaled("CustomerPayment");
  for (const p of await prisma.customerPayment.findMany({ orderBy: { date: "asc" } })) {
    if (custPay.has(p.id)) continue;
    await withTx(async (tx) => {
      if (!p.accountId) await tx.customerPayment.update({ where: { id: p.id }, data: { accountId: await accountId(tx, p.method === "CASH" ? "CASH" : "BANK") } });
      await postCustomerPaymentJournal(tx, ctxOf(p.createdById), p.id);
    });
    counts["Customer receipts"] = (counts["Customer receipts"] ?? 0) + 1;
  }
  const supPay = await journaled("SupplierPayment");
  for (const p of await prisma.supplierPayment.findMany({ orderBy: { date: "asc" } })) {
    if (supPay.has(p.id)) continue;
    await withTx(async (tx) => {
      if (!p.accountId) await tx.supplierPayment.update({ where: { id: p.id }, data: { accountId: await accountId(tx, p.method === "CASH" ? "CASH" : "BANK") } });
      await postSupplierPaymentJournal(tx, ctxOf(p.createdById), p.id);
    });
    counts["Supplier payments"] = (counts["Supplier payments"] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(counts)) if (!["Goods receipts", "Purchase returns", "Deliveries", "Stock documents", "Stock counts"].includes(k)) log(`${k}: ${v} journal(s) posted`);
  return counts;
}
