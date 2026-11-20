import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { saveSalesOrder, salesOrderAction } from "@/server/services/sales";
import { createSalesInvoice, postSalesInvoice } from "@/server/services/finance";
import { recordCustomerPayment, recordSupplierPayment, recordRefund } from "@/server/services/payments";
import { createAccount, saveCostCenter, saveJournal, postManualJournal } from "@/server/services/accounting";
import { saveAsset, capitaliseAsset, runDepreciation, disposeAsset } from "@/server/services/fixed-assets";
import { saveBudget, budgetVsActual } from "@/server/services/budgets";
import { importStatement, autoMatch, bookStatementLine, reconciliation, completeReconciliation, parseStatementCsv, deleteStatement } from "@/server/services/bank";
import { postRevaluation, revaluationPreview, cashFlow } from "@/server/services/period-end";
import { assertOpenPeriod, ledgerDate } from "@/server/accounting/ledger";
import { D } from "@/lib/decimal";
import { ctxFor, superCtx, makeCustomer, makeItem, makeSupplier, uid } from "./helpers";

const key = async (k: string) => (await prisma.accountDefault.findUniqueOrThrow({ where: { key: k } })).accountId;
async function partyBalance(accountKey: string, partyType: string, partyId: string) {
  const r = await prisma.journalLine.aggregate({ where: { posted: true, accountId: await key(accountKey), partyType, partyId }, _sum: { debit: true, credit: true } });
  return Number(D(r._sum.debit).sub(D(r._sum.credit)));
}
async function lines(sourceType: string, sourceId: string) {
  return prisma.journalLine.findMany({ where: { posted: true, journal: { sourceType, sourceId } } });
}
const amt = (ls: { accountId: string; debit: unknown; credit: unknown }[], accountId: string) =>
  Number(ls.filter((l) => l.accountId === accountId).reduce((s, l) => s.add(D(l.debit as string)).sub(D(l.credit as string)), D(0)));

async function newBankAccount() {
  const fin = await ctxFor("FINANCE_OFFICER");
  const parent = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
  return createAccount(fin, { code: uid("B"), name: `Test bank ${uid()}`, type: "ASSET", parentId: parent.id, isBank: true });
}

describe("Refunds", () => {
  it("pays back unused customer credit and records supplier refunds against their source", async () => {
    const admin = await superCtx();
    const fin = await ctxFor("FINANCE_OFFICER");
    const cust = await makeCustomer(admin);
    const rc = await recordCustomerPayment(fin, { customerId: cust.id, amount: "500" });
    expect(await partyBalance("AR", "CUSTOMER", cust.id)).toBe(-500);
    await expect(recordRefund(fin, { side: "CUSTOMER", paymentId: rc.id, amount: "600", reason: "x" })).rejects.toThrow(/only 500/);
    const r = await recordRefund(fin, { side: "CUSTOMER", paymentId: rc.id, amount: "200", reason: "Customer overpaid" });
    const ls = await lines("Refund", r.id);
    expect(amt(ls, await key("AR"))).toBe(200);
    expect(amt(ls, await key("BANK"))).toBe(-200);
    expect(await partyBalance("AR", "CUSTOMER", cust.id)).toBe(-300);
    expect(Number((await prisma.customerPayment.findUniqueOrThrow({ where: { id: rc.id } })).allocatedAmount)).toBe(200);

    const sup = await makeSupplier(admin);
    const sp = await recordSupplierPayment(fin, { supplierId: sup.id, amount: "300" });
    expect(await partyBalance("AP", "SUPPLIER", sup.id)).toBe(300);
    await recordRefund(fin, { side: "SUPPLIER", paymentId: sp.id, amount: "300", reason: "Order cancelled, deposit returned" });
    expect(await partyBalance("AP", "SUPPLIER", sup.id)).toBe(0);
    await expect(recordRefund(await ctxFor("STOREKEEPER"), { side: "CUSTOMER", paymentId: rc.id, amount: "1", reason: "x" })).rejects.toThrow(/permission/i);
  });
});

describe("Period-end foreign-currency revaluation", () => {
  it("restates an open USD receivable at the period-end rate and reverses it the next day", async () => {
    const admin = await superCtx();
    const fin = await ctxFor("FINANCE_OFFICER");
    const officer = await ctxFor("SALES_OFFICER"), mgr = await ctxFor("SALES_MANAGER");
    const cust = await makeCustomer(admin);
    const svc = await makeItem(admin, { itemType: "SERVICE" });
    const so = await saveSalesOrder(officer, null, { customerId: cust.id, warehouseId: (await prisma.warehouse.findFirstOrThrow()).id, currency: "USD", lines: [{ itemId: svc.id, description: "x", quantity: "1", unitPrice: "1000" }] });
    await salesOrderAction(officer, so.id, "submit");
    await salesOrderAction(mgr, so.id, "approve");
    const sol = await prisma.salesOrderLine.findFirstOrThrow({ where: { orderId: so.id } });
    const inv = await createSalesInvoice(fin, { salesOrderId: so.id, lines: [{ salesOrderLineId: sol.id, quantity: "1" }] });
    await postSalesInvoice(fin, inv.id);
    const booked = Number(inv.exchangeRate);
    const before = await partyBalance("AR", "CUSTOMER", cust.id);

    // A unique far-future date per run keeps the revaluation idempotency key unique in the shared test database.
    const asOf = new Date(Date.UTC(2200, 0, 1) + Math.floor(Math.random() * 2_000_000) * 86_400_000);
    const pv = await revaluationPreview(fin, asOf, { USD: "3.80" });
    const mine = pv.rows.find((r) => r.label === inv.number)!;
    expect(Number(mine.gain)).toBeCloseTo(1000 * (3.8 - booked), 2);
    const res = await postRevaluation(fin, { date: asOf, rates: { USD: "3.80" } });
    const j = await prisma.journalLine.findMany({ where: { journalId: res.journalId, partyId: cust.id } });
    expect(Number(D(j[0].debit).sub(D(j[0].credit)))).toBeCloseTo(1000 * (3.8 - booked), 2);
    const rev = await prisma.journalEntry.findUniqueOrThrow({ where: { id: res.reversalId } });
    expect(rev.date.toISOString().slice(0, 10)).toBe(new Date(ledgerDate(asOf).getTime() + 86_400_000).toISOString().slice(0, 10));
    expect(await partyBalance("AR", "CUSTOMER", cust.id)).toBeCloseTo(before, 2); // revaluation + reversal net to zero
    await expect(postRevaluation(fin, { date: asOf, rates: { USD: "3.80" } })).rejects.toThrow(/already been posted/);
  });
});

describe("Fixed assets", () => {
  it("capitalises, depreciates monthly with catch-up and never twice, and books the gain on disposal", async () => {
    const fin = await ctxFor("FINANCE_OFFICER");
    const cat = await prisma.assetCategory.findFirstOrThrow({ where: { name: "Equipment and tools" } });
    const y = 2001;
    await assertOpenPeriod(prisma as never, new Date(Date.UTC(y, 5, 1)));
    const a = await saveAsset(fin, null, { name: `Slickline unit ${uid()}`, categoryId: cat.id, acquisitionDate: `${y}-01-15`, cost: "12000", usefulLifeMonths: 12, serialNo: uid("SN") });
    await expect(saveAsset(fin, a.id, { name: "x", categoryId: cat.id, cost: "100", salvageValue: "100" })).rejects.toThrow(/Salvage/);
    await capitaliseAsset(fin, a.id, await key("BANK"));
    const cap = await lines("FixedAsset", a.id);
    expect(amt(cap, cat.assetAccountId)).toBe(12000);
    expect(amt(cap, await key("BANK"))).toBe(-12000);

    const run = await runDepreciation(fin, new Date(Date.UTC(y, 2, 10)));
    expect(run.assets).toBeGreaterThanOrEqual(1);
    const entry = await prisma.depreciationEntry.findFirstOrThrow({ where: { assetId: a.id } });
    expect(Number(entry.amount)).toBe(3000); // January to March caught up in one run
    const dep = await prisma.journalLine.findMany({ where: { journalId: entry.journalId, description: { startsWith: a.number } } });
    expect(amt(dep, cat.expenseAccountId)).toBe(3000);
    expect(amt(dep, cat.accumulatedAccountId)).toBe(-3000);
    await runDepreciation(fin, new Date(Date.UTC(y, 2, 31)));
    expect(await prisma.depreciationEntry.count({ where: { assetId: a.id } })).toBe(1);

    await expect(disposeAsset(fin, a.id, { date: `${y}-05-10`, proceeds: "10000", proceedsAccountId: await key("BANK"), reason: "Sold" })).rejects.toThrow(/Run depreciation up to/);
    await runDepreciation(fin, new Date(Date.UTC(y, 3, 30)));
    const res = await disposeAsset(fin, a.id, { date: `${y}-05-10`, proceeds: "10000", proceedsAccountId: await key("BANK"), reason: "Sold to contractor" });
    expect(Number(res.gainOrLoss)).toBe(2000); // NBV 12,000 − 4,000 = 8,000; proceeds 10,000
    const disp = await prisma.journalLine.findMany({ where: { posted: true, journal: { sourceType: "FixedAsset", sourceId: a.id, sourceKind: "DISPOSE" } } });
    expect(amt(disp, await key("ASSET_DISPOSAL"))).toBe(-2000);
    expect(amt(disp, cat.accumulatedAccountId)).toBe(4000);
    expect(amt(disp, cat.assetAccountId)).toBe(-12000);
    expect((await prisma.fixedAsset.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("DISPOSED");
  });
});

describe("Budgets", () => {
  it("compares monthly budget with actual postings for a cost centre", async () => {
    const fin = await ctxFor("FINANCE_OFFICER"), f2 = await ctxFor("FINANCE_OFFICER");
    const today = ledgerDate(new Date());
    await assertOpenPeriod(prisma as never, today);
    const fy = await prisma.fiscalYear.findFirstOrThrow({ where: { startDate: { lte: today }, endDate: { gte: today } } });
    const cc = await saveCostCenter(fin, null, { code: uid("CC"), name: "Budget test" });
    const rent = await prisma.account.findUniqueOrThrow({ where: { code: "6200" } });
    const sales = await prisma.account.findUniqueOrThrow({ where: { code: "4200" } });
    await expect(saveBudget(fin, null, { name: "x", fiscalYearId: fy.id, lines: [{ accountId: await key("BANK"), annual: "100" }] })).rejects.toThrow(/income and expense/);
    const b = await saveBudget(fin, null, { name: `Plan ${uid()}`, fiscalYearId: fy.id, costCenterId: cc.id, lines: [{ accountId: rent.id, annual: "12000" }, { accountId: sales.id, annual: "60000" }] });
    expect(Number((await prisma.budgetLine.aggregate({ where: { budgetId: b.id, accountId: rent.id }, _sum: { amount: true } }))._sum.amount)).toBe(12000);
    const j = await saveJournal(fin, null, { memo: "Rent", lines: [{ accountId: rent.id, debit: "1500", costCenterId: cc.id }, { accountId: await key("BANK"), credit: "1500" }] });
    await postManualJournal(f2, j.id);
    const r = (await budgetVsActual(fin, b.id, { from: today, to: today }))!;
    const row = r.rows.find((x) => x.id === rent.id)!;
    expect(Number(row.budget)).toBe(1000);
    expect(Number(row.actual)).toBe(1500);
    expect(Number(row.variance)).toBe(500);
    expect(row.favourable).toBe(false);
    expect(Number(r.rows.find((x) => x.id === sales.id)!.budget)).toBe(5000);
  });
});

describe("Bank reconciliation", () => {
  it("imports a CSV statement, auto-matches, books bank charges and proves the balance with an uncleared cheque", async () => {
    const admin = await superCtx();
    const fin = await ctxFor("FINANCE_OFFICER");
    const bank = await newBankAccount();
    const cust = await makeCustomer(admin), sup = await makeSupplier(admin);
    const d1 = "2026-11-02", d2 = "2026-11-05", d3 = "2026-11-08";
    await recordCustomerPayment(fin, { customerId: cust.id, amount: "5000", accountId: bank.id, date: d1, reference: "TT-1001" });
    await recordSupplierPayment(fin, { supplierId: sup.id, amount: "1200", accountId: bank.id, date: d2, reference: "CHQ-77" });
    await recordSupplierPayment(fin, { supplierId: sup.id, amount: "800", accountId: bank.id, date: d3, reference: "CHQ-78" }); // not yet presented

    const csv = `Date,Description,Reference,Debit,Credit\n02/11/2026,"Transfer from customer",TT-1001,,"5,000.00"\n06/11/2026,Cheque 77,CHQ-77,1200.00,\n10/11/2026,Monthly account fee,,25.00,`;
    expect(parseStatementCsv(csv).map((l) => Number(l.amount))).toEqual([5000, -1200, -25]);
    await expect(importStatement(fin, { accountId: bank.id, reference: "S1", openingBalance: "0", closingBalance: "9999", csv })).rejects.toThrow(/closing balance/);
    const st = await importStatement(fin, { accountId: bank.id, reference: "S1", statementDate: "2026-11-10", openingBalance: "0", closingBalance: "3775", csv });
    const m = await autoMatch(fin, st.id);
    expect(m.matched).toBe(2);
    let rec = (await reconciliation(fin, st.id))!;
    expect(Number(rec.uncleared)).toBe(-800); // cheque 78 issued, not yet on the statement
    expect(Number(rec.notBooked)).toBe(-25);
    expect(Number(rec.difference)).toBe(0);
    await expect(completeReconciliation(fin, st.id)).rejects.toThrow(/Match or book/);
    const fee = await prisma.bankStatementLine.findFirstOrThrow({ where: { statementId: st.id, journalLineId: null } });
    await bookStatementLine(fin, fee.id, { description: "Bank fee" });
    rec = (await reconciliation(fin, st.id))!;
    expect(rec.allMatched).toBe(true);
    expect(Number(rec.difference)).toBe(0);
    await completeReconciliation(fin, st.id);
    expect((await prisma.bankStatement.findUniqueOrThrow({ where: { id: st.id } })).status).toBe("RECONCILED");
    const feeLines = await prisma.journalLine.findMany({ where: { journal: { sourceType: "BankStatementLine", sourceId: fee.id } } });
    expect(amt(feeLines, await key("BANK_CHARGES"))).toBe(25);
    await expect(importStatement(fin, { accountId: bank.id, reference: "S1", openingBalance: "0", closingBalance: "3775", csv })).rejects.toThrow(/already been imported/);
    await expect(deleteStatement(fin, st.id)).rejects.toThrow(/already reconciled/);
  });

  it("deletes a statement imported into the wrong account and reverses what was booked from it", async () => {
    const fin = await ctxFor("FINANCE_OFFICER");
    const wrong = await newBankAccount();
    const st = await importStatement(fin, { accountId: wrong.id, reference: "W1", openingBalance: "0", closingBalance: "-40", lines: [{ date: "2026-11-03", description: "Fee", amount: "-40" }] });
    const line = await prisma.bankStatementLine.findFirstOrThrow({ where: { statementId: st.id } });
    await bookStatementLine(fin, line.id, {});
    const bal = async () => Number((await prisma.journalLine.aggregate({ where: { posted: true, accountId: wrong.id }, _sum: { debit: true, credit: true } }))._sum.credit ?? 0);
    expect(await bal()).toBe(40);
    await deleteStatement(fin, st.id);
    expect(await prisma.bankStatement.findUnique({ where: { id: st.id } })).toBeNull();
    const net = await prisma.journalLine.aggregate({ where: { posted: true, accountId: wrong.id }, _sum: { debit: true, credit: true } });
    expect(Number(D(net._sum.debit).sub(D(net._sum.credit)))).toBe(0);
  });
});

describe("Cash flow statement", () => {
  it("explains the full change in cash by activity", async () => {
    const gm = await ctxFor("GENERAL_MANAGER");
    const cf = await cashFlow(gm, { from: new Date("2000-01-01"), to: new Date(Date.UTC(2400, 0, 1)) });
    expect(cf.difference.toFixed(2)).toBe("0.00");
    const sections = cf.totals.OPERATING.add(cf.totals.INVESTING).add(cf.totals.FINANCING);
    expect(sections.toFixed(2)).toBe(cf.net.toFixed(2));
    expect(cf.rows.some((r) => r.label.startsWith("Receipts from customers"))).toBe(true);
  });
});
