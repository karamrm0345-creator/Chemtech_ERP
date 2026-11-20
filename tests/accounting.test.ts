import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { saveSalesOrder, salesOrderAction, createDelivery, postDelivery } from "@/server/services/sales";
import { createSalesInvoice, postSalesInvoice, recordCustomerPayment, createPurchaseInvoice, postPurchaseInvoice, recordSupplierPayment } from "@/server/services/finance";
import { savePurchaseOrder, purchaseOrderAction, createGoodsReceipt, postGoodsReceipt } from "@/server/services/purchasing";
import { createStockDocument, postStockDocument, reverseStockDocument } from "@/server/services/inventory";
import {
  saveJournal, postManualJournal, reverseManualJournal, trialBalance, balanceSheet, profitAndLoss, createFiscalYear, closeFiscalYear,
  reopenFiscalYear, setBooksLock, generalLedger, chartOfAccounts, createAccount,
} from "@/server/services/accounting";
import { D, ZERO } from "@/lib/decimal";
import { ctxFor, superCtx, makeCustomer, makeItem, makeSupplier, makeWarehouse, openingBalance, uid } from "./helpers";

const acct = async (key: string) => (await prisma.accountDefault.findUniqueOrThrow({ where: { key }, include: { account: true } })).account;

/** Posted ledger lines of a document, summed per posting-account key (debit − credit). */
async function booked(sourceType: string, sourceId: string) {
  const lines = await prisma.journalLine.findMany({ where: { posted: true, journal: { sourceType, sourceId } } });
  const keys = await prisma.accountDefault.findMany();
  const out: Record<string, number> = {};
  for (const l of lines) {
    const k = keys.find((x) => x.accountId === l.accountId)?.key ?? l.accountId;
    out[k] = Number(D(out[k] ?? 0).add(D(l.debit)).sub(D(l.credit)));
  }
  return out;
}

describe("General ledger postings", () => {
  it("posts the sales cycle: delivery at cost, invoice with tax, receipt to bank", async () => {
    const admin = await superCtx();
    const officer = await ctxFor("SALES_OFFICER");
    const mgr = await ctxFor("SALES_MANAGER");
    const keeper = await ctxFor("STOREKEEPER");
    const fin = await ctxFor("FINANCE_OFFICER");
    const item = await makeItem(admin);
    const wh = await makeWarehouse();
    const ob = await openingBalance(item.id, wh.id, "10", "40");
    expect(await booked("StockDocument", ob.id)).toEqual({ INVENTORY: 400, OPENING_BALANCE: -400 });

    const so = await saveSalesOrder(officer, null, { customerId: (await makeCustomer(admin)).id, warehouseId: wh.id, lines: [{ itemId: item.id, description: "x", quantity: "4", unitPrice: "100", taxRate: "5" }] });
    await salesOrderAction(officer, so.id, "submit");
    await salesOrderAction(mgr, so.id, "approve");
    const line = await prisma.salesOrderLine.findFirstOrThrow({ where: { orderId: so.id } });
    const d = await createDelivery(keeper, { salesOrderId: so.id, lines: [{ salesOrderLineId: line.id, quantity: "4" }] });
    await postDelivery(keeper, d.id);
    expect(await booked("DeliveryOrder", d.id)).toEqual({ COGS: 160, INVENTORY: -160 });

    const inv = await createSalesInvoice(fin, { salesOrderId: so.id, lines: [{ salesOrderLineId: line.id, quantity: "4" }] });
    await postSalesInvoice(fin, inv.id);
    expect(await booked("SalesInvoice", inv.id)).toEqual({ AR: 420, SALES: -400, TAX_OUTPUT: -20 });

    const p = await recordCustomerPayment(fin, { invoiceId: inv.id, amount: "420" });
    expect(await booked("CustomerPayment", p.id)).toEqual({ BANK: 420, AR: -420 });
    // Customer statement: AR for this customer nets to zero after payment.
    const st = await generalLedger(fin, { accountId: (await acct("AR")).id, partyType: "CUSTOMER", partyId: so.customerId, from: new Date("2000-01-01"), to: new Date() });
    expect(Number(st.closing)).toBe(0);
  });

  it("clears GRNI on the supplier invoice, booking price variance and freight", async () => {
    const admin = await superCtx();
    const off = await ctxFor("PROCUREMENT_OFFICER");
    const mgr = await ctxFor("PROCUREMENT_MANAGER");
    const keeper = await ctxFor("STOREKEEPER");
    const fin = await ctxFor("FINANCE_OFFICER");
    const item = await makeItem(admin);
    const supplier = await makeSupplier(admin);
    const po = await savePurchaseOrder(off, null, { supplierId: supplier.id, warehouseId: (await makeWarehouse()).id, freight: "100", lines: [{ itemId: item.id, description: "x", quantity: "10", unitPrice: "20" }] });
    await purchaseOrderAction(off, po.id, "submit");
    await purchaseOrderAction(mgr, po.id, "approve");
    const pol = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { orderId: po.id } });
    const g = await createGoodsReceipt(keeper, { purchaseOrderId: po.id, lines: [{ poLineId: pol.id, receivedQty: "10" }] });
    await postGoodsReceipt(keeper, g.id);
    expect(await booked("GoodsReceipt", g.id)).toEqual({ INVENTORY: 300, GRNI: -300 });

    const pi = await createPurchaseInvoice(fin, { purchaseOrderId: po.id, supplierInvoiceNo: `S-${uid()}`, charges: "100", lines: [{ poLineId: pol.id, quantity: "10", unitPrice: "22" }] });
    expect(Number(pi.total)).toBe(320);
    await postPurchaseInvoice(fin, pi.id, "Supplier price increase accepted");
    expect(await booked("PurchaseInvoice", pi.id)).toEqual({ GRNI: 300, PRICE_VARIANCE: 20, AP: -320 });

    const pay = await recordSupplierPayment(fin, { invoiceId: pi.id, amount: "320" });
    expect(await booked("SupplierPayment", pay.id)).toEqual({ AP: 320, BANK: -320 });
    const ap = await generalLedger(fin, { accountId: (await acct("AP")).id, partyType: "SUPPLIER", partyId: supplier.id, from: new Date("2000-01-01"), to: new Date() });
    expect(Number(ap.closing)).toBe(0);
  });

  it("keeps the inventory account equal to the stock ledger value, including transfers and reversals", async () => {
    const admin = await superCtx();
    const keeper = await ctxFor("STOREKEEPER");
    const storeMgr = await ctxFor("STORE_MANAGER");
    const item = await makeItem(admin);
    const [a, b] = [await makeWarehouse(), await makeWarehouse()];
    const ob = await openingBalance(item.id, a.id, "20", "12.5");
    const tr = await createStockDocument(keeper, { type: "TRANSFER", warehouseId: a.id, toWarehouseId: b.id, lines: [{ itemId: item.id, quantity: "5" }] });
    await postStockDocument(keeper, tr.id);
    expect(await booked("StockDocument", tr.id)).toEqual({}); // value moves inside the inventory account
    const adj = await createStockDocument(keeper, { type: "ADJUSTMENT", warehouseId: a.id, reason: "Damaged", lines: [{ itemId: item.id, quantity: "-3" }] });
    await postStockDocument(storeMgr, adj.id);
    expect(await booked("StockDocument", adj.id)).toEqual({ STOCK_ADJUSTMENT: 37.5, INVENTORY: -37.5 });
    await reverseStockDocument(storeMgr, adj.id, "Found the drums");
    expect(await booked("StockDocument", adj.id)).toEqual({ STOCK_ADJUSTMENT: 0, INVENTORY: 0 });

    const docs = [ob.id, tr.id, adj.id];
    const stockValue = await prisma.inventoryTransaction.aggregate({ where: { refDocId: { in: docs } }, _sum: { totalValue: true } });
    const inv = await acct("INVENTORY");
    const gl = await prisma.journalLine.aggregate({ where: { posted: true, accountId: inv.id, journal: { sourceId: { in: docs } } }, _sum: { debit: true, credit: true } });
    expect(Number(D(gl._sum.debit).sub(D(gl._sum.credit)))).toBe(Number(stockValue._sum.totalValue));
  });

  it("keeps the trial balance and balance sheet in balance", async () => {
    const gm = await ctxFor("GENERAL_MANAGER");
    const tb = await trialBalance(gm, { from: new Date("2000-01-01"), to: new Date() });
    expect(tb.totals.debit.toFixed(2)).toBe(tb.totals.credit.toFixed(2));
    expect(tb.totals.closingDr.toFixed(2)).toBe(tb.totals.closingCr.toFixed(2));
    const bs = await balanceSheet(gm, { asOf: new Date() });
    expect(bs.difference.toFixed(2)).toBe("0.00");
  });
});

describe("Manual journals and controls", () => {
  it("enforces balance and separation of duties, and reverses posted journals", async () => {
    const f1 = await ctxFor("FINANCE_OFFICER");
    const f2 = await ctxFor("FINANCE_OFFICER");
    const rent = await prisma.account.findUniqueOrThrow({ where: { code: "6200" } });
    const bank = await acct("BANK");
    const lines = [{ accountId: rent.id, debit: "1500" }, { accountId: bank.id, credit: "1500" }];
    const bad = await saveJournal(f1, null, { memo: "Unbalanced", lines: [{ accountId: rent.id, debit: "1500" }, { accountId: bank.id, credit: "1400" }] });
    await expect(postManualJournal(f2, bad.id)).rejects.toThrow(/does not balance/);
    await expect(saveJournal(f1, null, { memo: "Both sides", lines: [{ accountId: rent.id, debit: "1", credit: "1" }, { accountId: bank.id, credit: "1" }] })).rejects.toThrow(/either a debit or a credit/);
    const group = await prisma.account.findUniqueOrThrow({ where: { code: "6000" } });
    await expect(saveJournal(f1, null, { memo: "Group", lines: [{ accountId: group.id, debit: "1" }, { accountId: bank.id, credit: "1" }] })).rejects.toThrow(/cannot take postings/);

    const j = await saveJournal(f1, null, { memo: "Office rent", reference: uid("RENT"), lines });
    await expect(postManualJournal(f1, j.id)).rejects.toThrow(/Separation of duties/);
    await postManualJournal(f2, j.id);
    const posted = await prisma.journalEntry.findUniqueOrThrow({ where: { id: j.id }, include: { lines: true } });
    expect(posted.status).toBe("POSTED");
    expect(posted.lines.every((l) => l.posted)).toBe(true);
    await expect(saveJournal(f1, j.id, { memo: "edit", lines })).rejects.toThrow(/Only draft/);

    const rev = await reverseManualJournal(f2, j.id, "Booked twice");
    const revLines = await prisma.journalLine.findMany({ where: { journalId: rev.id } });
    expect(revLines.find((l) => l.accountId === rent.id)?.credit.toString()).toBe("1500");
    await expect(reverseManualJournal(f2, j.id, "again")).rejects.toThrow(/already reversed/);
  });

  it("restricts accounting by permission", async () => {
    const keeper = await ctxFor("STOREKEEPER");
    const auditor = await ctxFor("AUDITOR");
    await expect(chartOfAccounts(keeper)).rejects.toThrow(/permission/i);
    expect((await chartOfAccounts(auditor)).length).toBeGreaterThan(10);
    const bank = await acct("BANK");
    await expect(saveJournal(auditor, null, { memo: "x", lines: [{ accountId: bank.id, debit: "1" }, { accountId: bank.id, credit: "1" }] })).rejects.toThrow(/permission/i);
    await expect(createAccount(await ctxFor("SALES_MANAGER"), { code: uid("X"), name: "x", type: "ASSET" })).rejects.toThrow(/permission/i);
  });
});

describe("Fiscal years and period close", () => {
  it("refuses postings in locked periods and closes the year into retained earnings", async () => {
    const gm = await ctxFor("GENERAL_MANAGER");
    const f1 = await ctxFor("FINANCE_OFFICER");
    const f2 = await ctxFor("FINANCE_OFFICER");
    // Leave the shared test database usable: reopen test years left closed by an interrupted run, newest first.
    for (const fy of await prisma.fiscalYear.findMany({ where: { status: "CLOSED", name: { startsWith: "TFY-" } }, orderBy: { endDate: "desc" } })) {
      await reopenFiscalYear(gm, fy.id, "test cleanup");
    }
    await setBooksLock(gm, null);
    // Use a year before every existing fiscal year so it can be closed in order.
    const first = await prisma.fiscalYear.findFirst({ orderBy: { startDate: "asc" } });
    const y = Math.min(first ? first.startDate.getUTCFullYear() - 1 : 1899, 1899);
    const fy = await createFiscalYear(gm, { name: `TFY-${y}`, startDate: `${y}-01-01`, endDate: `${y}-12-31` });

    const sales = await acct("SALES");
    const bank = await acct("BANK");
    const salaries = await prisma.account.findUniqueOrThrow({ where: { code: "6100" } });
    const post = async (date: string, lines: { accountId: string; debit?: string; credit?: string }[]) => {
      const j = await saveJournal(f1, null, { date, memo: `Test ${date}`, lines });
      await postManualJournal(f2, j.id);
      return j;
    };
    await post(`${y}-03-01`, [{ accountId: bank.id, debit: "1000" }, { accountId: sales.id, credit: "1000" }]);
    await post(`${y}-04-01`, [{ accountId: salaries.id, debit: "300" }, { accountId: bank.id, credit: "300" }]);

    await setBooksLock(gm, new Date(`${y}-06-30T00:00:00+03:00`));
    const late = await saveJournal(f1, null, { date: `${y}-05-01`, memo: "Late", lines: [{ accountId: salaries.id, debit: "1" }, { accountId: bank.id, credit: "1" }] });
    await expect(postManualJournal(f2, late.id)).rejects.toThrow(/books are closed/);
    await prisma.journalEntry.update({ where: { id: late.id }, data: { status: "CANCELLED" } });

    const pl = await profitAndLoss(gm, { from: new Date(`${y}-01-01`), to: new Date(`${y}-12-31`) });
    expect(pl.netProfit.toFixed(2)).toBe("700.00");

    const r = await closeFiscalYear(gm, fy.id);
    expect(r.profit.toFixed(2)).toBe("700.00");
    const closed = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: fy.id } });
    expect(closed.status).toBe("CLOSED");
    const plAfter = await profitAndLoss(gm, { from: new Date(`${y}-01-01`), to: new Date(`${y}-12-31`) });
    expect(plAfter.netProfit.toFixed(2)).toBe("700.00"); // closing entry excluded from P&L
    const re = await acct("RETAINED_EARNINGS");
    const reLines = await prisma.journalLine.aggregate({ where: { posted: true, accountId: re.id, journalId: closed.closingJournalId! }, _sum: { credit: true, debit: true } });
    expect(D(reLines._sum.credit).sub(D(reLines._sum.debit)).toFixed(2)).toBe("700.00");
    const bs = await balanceSheet(gm, { asOf: new Date(`${y}-12-31`) });
    expect(bs.difference.toFixed(2)).toBe("0.00");
    expect(bs.unclosedProfit.toFixed(2)).toBe(ZERO.toFixed(2));
    const afterClose = await saveJournal(f1, null, { date: `${y}-11-01`, memo: "After close", lines: [{ accountId: salaries.id, debit: "1" }, { accountId: bank.id, credit: "1" }] });
    await expect(postManualJournal(f2, afterClose.id)).rejects.toThrow(/closed/);
    await prisma.journalEntry.update({ where: { id: afterClose.id }, data: { status: "CANCELLED" } });

    await reopenFiscalYear(gm, fy.id, "Audit adjustment");
    expect((await prisma.fiscalYear.findUniqueOrThrow({ where: { id: fy.id } })).status).toBe("OPEN");
    const bs2 = await balanceSheet(gm, { asOf: new Date(`${y}-12-31`) });
    expect(bs2.unclosedProfit.toFixed(2)).not.toBe("0.00");
  });
});

describe("Ledger reconciliation", () => {
  it("backfills older documents and reconciles inventory, receivables and payables (less unallocated credits) to their sub-ledgers", async () => {
    const { backfillLedger } = await import("@/server/accounting/backfill");
    await backfillLedger();
    // One statement = one snapshot, so documents posted concurrently by other test files cannot skew the comparison.
    const [r] = await prisma.$queryRaw<{ tb: string; inv_gl: string; inv_sl: string; ar_gl: string; ar_sl: string; ap_gl: string; ap_sl: string }[]>`
      SELECT
        (SELECT COALESCE(SUM(debit - credit), 0) FROM "JournalLine" WHERE posted)::text AS tb,
        (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM "JournalLine" l JOIN "AccountDefault" d ON d."accountId" = l."accountId" AND d.key = 'INVENTORY' WHERE l.posted)::text AS inv_gl,
        (SELECT COALESCE(SUM("totalValue"), 0) FROM "InventoryTransaction")::text AS inv_sl,
        (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM "JournalLine" l JOIN "AccountDefault" d ON d."accountId" = l."accountId" AND d.key = 'AR' WHERE l.posted AND l."partyType" = 'CUSTOMER')::text AS ar_gl,
        ((SELECT COALESCE(SUM(ROUND((total - "paidAmount") * "exchangeRate", 2)), 0) FROM "SalesInvoice" WHERE status IN ('POSTED', 'PARTIALLY_PAID', 'PAID'))
          - (SELECT COALESCE(SUM(ROUND((amount - "allocatedAmount") * "exchangeRate", 2)), 0) FROM "CustomerPayment")
          - (SELECT COALESCE(SUM(ROUND((total - "allocatedAmount") * "exchangeRate", 2)), 0) FROM "CreditNote" WHERE status = 'POSTED'))::text AS ar_sl,
        (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM "JournalLine" l JOIN "AccountDefault" d ON d."accountId" = l."accountId" AND d.key = 'AP' WHERE l.posted AND l."partyType" = 'SUPPLIER')::text AS ap_gl,
        ((SELECT COALESCE(SUM(ROUND((total - "paidAmount") * "exchangeRate", 2)), 0) FROM "PurchaseInvoice" WHERE status IN ('POSTED', 'PARTIALLY_PAID', 'PAID'))
          - (SELECT COALESCE(SUM(ROUND((amount - "allocatedAmount") * "exchangeRate", 2)), 0) FROM "SupplierPayment")
          - (SELECT COALESCE(SUM(ROUND((total - "allocatedAmount") * "exchangeRate", 2)), 0) FROM "DebitNote" WHERE status = 'POSTED'))::text AS ap_sl`;
    expect(Number(r.tb)).toBe(0);
    expect(Number(r.inv_gl)).toBe(Number(r.inv_sl));
    expect(Number(r.ar_gl)).toBeCloseTo(Number(r.ar_sl), 2);
    expect(Number(r.ap_gl)).toBeCloseTo(Number(r.ap_sl), 2);
  });
});
