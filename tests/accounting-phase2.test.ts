import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { saveSalesOrder, salesOrderAction, createDelivery, postDelivery } from "@/server/services/sales";
import { createSalesInvoice, postSalesInvoice, createPurchaseInvoice, postPurchaseInvoice, invoiceableLines } from "@/server/services/finance";
import { recordCustomerPayment, recordSupplierPayment, allocateCustomerCredit } from "@/server/services/payments";
import { createCustomerReturn, createCreditNote, postCreditNote, createDebitNote, postDebitNote } from "@/server/services/returns";
import { savePurchaseOrder, purchaseOrderAction, createGoodsReceipt, postGoodsReceipt, createAndPostPurchaseReturn } from "@/server/services/purchasing";
import { saveCostCenter, saveTaxCode, profitAndLoss, saveJournal, postManualJournal, createAccount } from "@/server/services/accounting";
import { runReport } from "@/server/services/reports";
import { D } from "@/lib/decimal";
import { ctxFor, superCtx, makeCustomer, makeItem, makeSupplier, makeWarehouse, openingBalance, stock, uid } from "./helpers";

const key = async (k: string) => (await prisma.accountDefault.findUniqueOrThrow({ where: { key: k } })).accountId;

/** Posted ledger movement (debit − credit) per posting-account key for a source document. */
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

/** Party balance on a control account (debit − credit) across all posted journals. */
async function partyBalance(accountKey: string, partyType: string, partyId: string) {
  const r = await prisma.journalLine.aggregate({ where: { posted: true, accountId: await key(accountKey), partyType, partyId }, _sum: { debit: true, credit: true } });
  return Number(D(r._sum.debit).sub(D(r._sum.credit)));
}

/** Approved sales order → (delivered) → posted invoice. */
async function postedInvoice(o: { customerId: string; itemId: string; qty: string; price: string; currency?: string; taxRate?: string; warehouseId?: string; deliver?: boolean; costCenterId?: string }) {
  const officer = await ctxFor("SALES_OFFICER"), mgr = await ctxFor("SALES_MANAGER"), fin = await ctxFor("FINANCE_OFFICER"), keeper = await ctxFor("STOREKEEPER");
  const wh = o.warehouseId ?? (await makeWarehouse()).id;
  const so = await saveSalesOrder(officer, null, { customerId: o.customerId, warehouseId: wh, currency: o.currency ?? "QAR", lines: [{ itemId: o.itemId, description: "line", quantity: o.qty, unitPrice: o.price, taxRate: o.taxRate ?? "0" }] });
  await salesOrderAction(officer, so.id, "submit");
  await salesOrderAction(mgr, so.id, "approve");
  const line = await prisma.salesOrderLine.findFirstOrThrow({ where: { orderId: so.id } });
  let deliveryId: string | undefined;
  if (o.deliver) {
    const d = await createDelivery(keeper, { salesOrderId: so.id, lines: [{ salesOrderLineId: line.id, quantity: o.qty }] });
    await postDelivery(keeper, d.id);
    deliveryId = d.id;
  }
  const inv = await createSalesInvoice(fin, { salesOrderId: so.id, costCenterId: o.costCenterId, lines: [{ salesOrderLineId: line.id, quantity: o.qty }] });
  await postSalesInvoice(fin, inv.id);
  return { inv, so, line, deliveryId, fin };
}

describe("Receipts with allocation, advances and exchange differences", () => {
  it("settles several invoices from one receipt and keeps the rest on account until allocated", async () => {
    const admin = await superCtx();
    const fin = await ctxFor("FINANCE_OFFICER");
    const cust = await makeCustomer(admin);
    const svc = await makeItem(admin, { itemType: "SERVICE" });
    const { inv: a } = await postedInvoice({ customerId: cust.id, itemId: svc.id, qty: "1", price: "1000" });
    const { inv: b } = await postedInvoice({ customerId: cust.id, itemId: svc.id, qty: "1", price: "600" });

    const p = await recordCustomerPayment(fin, { customerId: cust.id, amount: "1500", allocations: [{ invoiceId: a.id, amount: "1000" }, { invoiceId: b.id, amount: "400" }] });
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("PAID");
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PARTIALLY_PAID");
    expect(Number((await prisma.customerPayment.findUniqueOrThrow({ where: { id: p.id } })).allocatedAmount)).toBe(1400);
    expect(await booked("CustomerPayment", p.id)).toEqual({ BANK: 1500, AR: -1500 });
    expect(await partyBalance("AR", "CUSTOMER", cust.id)).toBe(100); // 1,600 invoiced − 1,500 received

    await expect(recordCustomerPayment(fin, { customerId: cust.id, amount: "100", allocations: [{ invoiceId: b.id, amount: "150" }] })).rejects.toThrow(/exceed/);
    await expect(allocateCustomerCredit(fin, { paymentId: p.id, invoiceId: b.id, amount: "150" })).rejects.toThrow(/left to allocate|exceeds/);
    const other = await makeCustomer(admin);
    const { inv: c } = await postedInvoice({ customerId: other.id, itemId: svc.id, qty: "1", price: "50" });
    await expect(allocateCustomerCredit(fin, { paymentId: p.id, invoiceId: c.id, amount: "50" })).rejects.toThrow(/different customer/);

    await allocateCustomerCredit(fin, { paymentId: p.id, invoiceId: b.id, amount: "100" });
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PARTIALLY_PAID");
    const pay2 = await recordCustomerPayment(fin, { invoiceId: b.id, amount: "100" });
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PAID");
    expect(Number((await prisma.customerPayment.findUniqueOrThrow({ where: { id: pay2.id } })).allocatedAmount)).toBe(100);
    expect(await partyBalance("AR", "CUSTOMER", cust.id)).toBe(0);
  });

  it("books the realised exchange difference when a USD invoice is paid at another rate", async () => {
    const admin = await superCtx();
    const fin = await ctxFor("FINANCE_OFFICER");
    const cust = await makeCustomer(admin);
    const svc = await makeItem(admin, { itemType: "SERVICE" });
    const { inv } = await postedInvoice({ customerId: cust.id, itemId: svc.id, qty: "1", price: "1000", currency: "USD" });
    const rate = Number(inv.exchangeRate);
    expect(await partyBalance("AR", "CUSTOMER", cust.id)).toBeCloseTo(1000 * rate, 2);
    const p = await recordCustomerPayment(fin, { customerId: cust.id, currency: "USD", exchangeRate: "3.60", amount: "1000", allocations: [{ invoiceId: inv.id, amount: "1000" }] });
    expect(await booked("CustomerPayment", p.id)).toEqual({ BANK: 3600, AR: -3600 });
    const alloc = await prisma.customerAllocation.findFirstOrThrow({ where: { paymentId: p.id } });
    expect(await booked("CustomerAllocation", alloc.id)).toEqual({ AR: -Number((1000 * (rate - 3.6)).toFixed(2)), EXCHANGE_DIFF: Number((1000 * (rate - 3.6)).toFixed(2)) });
    expect(await partyBalance("AR", "CUSTOMER", cust.id)).toBe(0);
  });
});

describe("Supplier payments with withholding tax", () => {
  it("pays the net amount, records withholding tax payable and settles the invoice in full", async () => {
    const admin = await superCtx();
    const off = await ctxFor("PROCUREMENT_OFFICER"), mgr = await ctxFor("PROCUREMENT_MANAGER"), keeper = await ctxFor("STOREKEEPER"), fin = await ctxFor("FINANCE_OFFICER");
    const supplier = await makeSupplier(admin);
    await prisma.supplier.update({ where: { id: supplier.id }, data: { withholdingRate: 5 } });
    const svc = await makeItem(admin, { itemType: "SERVICE" });
    const po = await savePurchaseOrder(off, null, { supplierId: supplier.id, warehouseId: (await makeWarehouse()).id, lines: [{ itemId: svc.id, description: "Inspection", quantity: "1", unitPrice: "1000" }] });
    await purchaseOrderAction(off, po.id, "submit");
    await purchaseOrderAction(mgr, po.id, "approve");
    const pol = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { orderId: po.id } });
    const g = await createGoodsReceipt(keeper, { purchaseOrderId: po.id, lines: [{ poLineId: pol.id, receivedQty: "1" }] });
    await postGoodsReceipt(keeper, g.id);
    const pi = await createPurchaseInvoice(fin, { purchaseOrderId: po.id, supplierInvoiceNo: `W-${uid()}`, lines: [{ poLineId: pol.id, quantity: "1", unitPrice: "1000" }] });
    await postPurchaseInvoice(fin, pi.id);
    expect(await booked("PurchaseInvoice", pi.id)).toEqual({ PURCHASE_EXPENSE: 1000, AP: -1000 });
    const pay = await recordSupplierPayment(fin, { invoiceId: pi.id, amount: "1000" });
    expect(await booked("SupplierPayment", pay.id)).toEqual({ AP: 1000, BANK: -950, WHT_PAYABLE: -50 });
    expect((await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: pi.id } })).status).toBe("PAID");
    expect(await partyBalance("AP", "SUPPLIER", supplier.id)).toBe(0);
  });
});

describe("Customer returns and credit notes", () => {
  it("returns goods at issue cost, limits invoicing to kept goods, and credits the invoice", async () => {
    const admin = await superCtx();
    const keeper = await ctxFor("STOREKEEPER");
    const item = await makeItem(admin);
    const wh = await makeWarehouse();
    await openingBalance(item.id, wh.id, "10", "40");
    const cust = await makeCustomer(admin);
    const officer = await ctxFor("SALES_OFFICER"), mgr = await ctxFor("SALES_MANAGER"), fin = await ctxFor("FINANCE_OFFICER");
    const so = await saveSalesOrder(officer, null, { customerId: cust.id, warehouseId: wh.id, lines: [{ itemId: item.id, description: "x", quantity: "4", unitPrice: "100", taxRate: "5" }] });
    await salesOrderAction(officer, so.id, "submit");
    await salesOrderAction(mgr, so.id, "approve");
    const sol = await prisma.salesOrderLine.findFirstOrThrow({ where: { orderId: so.id } });
    const dlv = await createDelivery(keeper, { salesOrderId: so.id, lines: [{ salesOrderLineId: sol.id, quantity: "4" }] });
    await postDelivery(keeper, dlv.id);
    expect(await stock(item.id, wh.id)).toBe(6);

    const dl = await prisma.deliveryOrderLine.findFirstOrThrow({ where: { deliveryId: dlv.id } });
    await expect(createCustomerReturn(await ctxFor("FINANCE_OFFICER"), { deliveryId: dlv.id, reason: "x", lines: [{ deliveryLineId: dl.id, quantity: "1" }] })).rejects.toThrow(/permission/i);
    await expect(createCustomerReturn(keeper, { deliveryId: dlv.id, reason: "Too many", lines: [{ deliveryLineId: dl.id, quantity: "5" }] })).rejects.toThrow(/only 4/);
    const ret = await createCustomerReturn(keeper, { deliveryId: dlv.id, reason: "Damaged in transit", lines: [{ deliveryLineId: dl.id, quantity: "1" }] });
    expect(await stock(item.id, wh.id)).toBe(7);
    expect(await booked("CustomerReturn", ret.id)).toEqual({ INVENTORY: 40, COGS: -40 });
    expect(Number((await invoiceableLines(so.id))[0].invoiceable)).toBe(3);

    const inv = await createSalesInvoice(fin, { salesOrderId: so.id, lines: [{ salesOrderLineId: sol.id, quantity: "3" }] });
    await postSalesInvoice(fin, inv.id);
    const il = await prisma.salesInvoiceLine.findFirstOrThrow({ where: { invoiceId: inv.id } });
    await expect(createCreditNote(fin, { invoiceId: inv.id, reason: "x", lines: [{ invoiceLineId: il.id, quantity: "4" }] })).rejects.toThrow(/only 3/);
    await expect(createCreditNote(fin, { invoiceId: inv.id, reason: "x", lines: [{ invoiceLineId: il.id, quantity: "1", unitPrice: "120" }] })).rejects.toThrow(/cannot exceed/);
    const cn = await createCreditNote(fin, { invoiceId: inv.id, reason: "Price allowance on one unit", customerReturnId: ret.id, lines: [{ invoiceLineId: il.id, quantity: "1" }] });
    expect(Number(cn.total)).toBe(105);
    await postCreditNote(fin, cn.id);
    expect(await booked("CreditNote", cn.id)).toEqual({ SALES: 100, TAX_OUTPUT: 5, AR: -105 });
    const after = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(Number(after.creditedAmount)).toBe(105);
    expect(Number(D(after.total).sub(D(after.paidAmount)))).toBe(210);
    await expect(postCreditNote(fin, cn.id)).rejects.toThrow(/Cannot post credit note/);

    // A credit note on a paid invoice stays as customer credit and can settle another invoice.
    await recordCustomerPayment(fin, { invoiceId: inv.id, amount: "210" });
    const cn2 = await createCreditNote(fin, { invoiceId: inv.id, reason: "Goodwill", lines: [{ invoiceLineId: il.id, quantity: "1", unitPrice: "50" }] });
    await postCreditNote(fin, cn2.id);
    expect(Number((await prisma.creditNote.findUniqueOrThrow({ where: { id: cn2.id } })).allocatedAmount)).toBe(0);
    const svc = await makeItem(admin, { itemType: "SERVICE" });
    const { inv: next } = await postedInvoice({ customerId: cust.id, itemId: svc.id, qty: "1", price: "200" });
    await allocateCustomerCredit(fin, { creditNoteId: cn2.id, invoiceId: next.id, amount: "52.5" });
    expect(Number((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: next.id } })).paidAmount)).toBe(52.5);
  });
});

describe("Debit notes", () => {
  it("clears GRNI for goods returned to the supplier and books the cost difference as variance", async () => {
    const admin = await superCtx();
    const off = await ctxFor("PROCUREMENT_OFFICER"), mgr = await ctxFor("PROCUREMENT_MANAGER"), keeper = await ctxFor("STOREKEEPER"), fin = await ctxFor("FINANCE_OFFICER");
    const item = await makeItem(admin);
    const wh = await makeWarehouse();
    await openingBalance(item.id, wh.id, "10", "30"); // average becomes 25 after receiving 10 at 20
    const supplier = await makeSupplier(admin);
    const po = await savePurchaseOrder(off, null, { supplierId: supplier.id, warehouseId: wh.id, lines: [{ itemId: item.id, description: "x", quantity: "10", unitPrice: "20" }] });
    await purchaseOrderAction(off, po.id, "submit");
    await purchaseOrderAction(mgr, po.id, "approve");
    const pol = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { orderId: po.id } });
    const g = await createGoodsReceipt(keeper, { purchaseOrderId: po.id, lines: [{ poLineId: pol.id, receivedQty: "10" }] });
    await postGoodsReceipt(keeper, g.id);
    const pi = await createPurchaseInvoice(fin, { purchaseOrderId: po.id, supplierInvoiceNo: `D-${uid()}`, lines: [{ poLineId: pol.id, quantity: "10", unitPrice: "20" }] });
    await postPurchaseInvoice(fin, pi.id);
    const ret = await createAndPostPurchaseReturn(await ctxFor("PROCUREMENT_MANAGER"), { purchaseOrderId: po.id, reason: "Wrong grade", lines: [{ poLineId: pol.id, quantity: "2" }] });
    expect(await booked("PurchaseReturn", ret.id)).toEqual({ GRNI: 50, INVENTORY: -50 });

    const pil = await prisma.purchaseInvoiceLine.findFirstOrThrow({ where: { invoiceId: pi.id } });
    const rl = await prisma.purchaseReturnLine.findFirstOrThrow({ where: { returnId: ret.id } });
    await expect(createDebitNote(fin, { invoiceId: pi.id, reason: "x", purchaseReturnId: ret.id, lines: [{ invoiceLineId: pil.id, quantity: "3", returnLineId: rl.id }] })).rejects.toThrow(/returned unit/);
    const dn = await createDebitNote(fin, { invoiceId: pi.id, reason: "Returned 2 drums", supplierRef: "SCN-1", purchaseReturnId: ret.id, lines: [{ invoiceLineId: pil.id, quantity: "2", returnLineId: rl.id }] });
    await postDebitNote(fin, dn.id);
    expect(await booked("DebitNote", dn.id)).toEqual({ AP: 40, GRNI: -50, PRICE_VARIANCE: 10 });
    const inv = await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: pi.id } });
    expect(Number(inv.debitedAmount)).toBe(40);
    expect(Number(D(inv.total).sub(D(inv.paidAmount)))).toBe(160);
    // GRNI for this order nets to zero across receipt, invoice, return and debit note.
    const grni = await prisma.journalLine.aggregate({ where: { posted: true, accountId: await key("GRNI"), journal: { sourceId: { in: [g.id, pi.id, ret.id, dn.id] } } }, _sum: { debit: true, credit: true } });
    expect(Number(D(grni._sum.debit).sub(D(grni._sum.credit)))).toBe(0);
    expect(await partyBalance("AP", "SUPPLIER", supplier.id)).toBe(-160);
  });
});

describe("Tax codes and cost centres", () => {
  it("posts tax to the tax code's account and reports revenue by cost centre", async () => {
    const admin = await superCtx();
    const fin = await ctxFor("FINANCE_OFFICER");
    const f2 = await ctxFor("FINANCE_OFFICER");
    const rate = (7 + Math.floor(Math.random() * 80) / 100).toFixed(2); // unique rate per run
    const taxAcc = await createAccount(fin, { code: uid("T"), name: "Special tax payable", type: "LIABILITY", parentId: (await prisma.account.findUniqueOrThrow({ where: { code: "2100" } })).id });
    await saveTaxCode(fin, null, { code: uid("TX"), name: `Special ${rate}%`, rate, outputAccountId: taxAcc.id });
    await expect(saveTaxCode(fin, null, { code: uid("TX"), name: "dup", rate })).rejects.toThrow(/already uses/);
    const cc = await saveCostCenter(fin, null, { code: uid("CC"), name: "Well testing division" });
    const cust = await makeCustomer(admin);
    const svc = await makeItem(admin, { itemType: "SERVICE" });
    const { inv } = await postedInvoice({ customerId: cust.id, itemId: svc.id, qty: "2", price: "500", taxRate: rate, costCenterId: cc.id });
    const tax = Number((1000 * Number(rate) / 100).toFixed(2));
    const lines = await prisma.journalLine.findMany({ where: { journal: { sourceType: "SalesInvoice", sourceId: inv.id } } });
    expect(Number(lines.find((l) => l.accountId === taxAcc.id)?.credit)).toBe(tax);
    expect(lines.find((l) => l.accountId === taxAcc.id)?.costCenterId).toBeNull();
    expect(lines.find((l) => Number(l.credit) === 1000)?.costCenterId).toBe(cc.id);

    const rent = await prisma.account.findUniqueOrThrow({ where: { code: "6200" } });
    const j = await saveJournal(fin, null, { memo: "Division rent", lines: [{ accountId: rent.id, debit: "300", costCenterId: cc.id }, { accountId: await key("BANK"), credit: "300" }] });
    await postManualJournal(f2, j.id);
    const pl = await profitAndLoss(fin, { from: new Date("2000-01-01"), to: new Date(), costCenterId: cc.id });
    expect(pl.income.toFixed(2)).toBe("1000.00");
    expect(pl.expense.toFixed(2)).toBe("300.00");
    expect(pl.netProfit.toFixed(2)).toBe("700.00");
  });
});

describe("Phase 2 reconciliation and reports", () => {
  it("keeps receivables and payables equal to open invoices less unallocated credits, and runs the new reports", async () => {
    const [r] = await prisma.$queryRaw<{ ar_gl: string; ar_sl: string; ap_gl: string; ap_sl: string }[]>`
      SELECT
        (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM "JournalLine" l JOIN "AccountDefault" d ON d."accountId" = l."accountId" AND d.key = 'AR' WHERE l.posted AND l."partyType" = 'CUSTOMER')::text AS ar_gl,
        ((SELECT COALESCE(SUM(ROUND((total - "paidAmount") * "exchangeRate", 2)), 0) FROM "SalesInvoice" WHERE status IN ('POSTED','PARTIALLY_PAID','PAID'))
          - (SELECT COALESCE(SUM(ROUND((amount - "allocatedAmount") * "exchangeRate", 2)), 0) FROM "CustomerPayment")
          - (SELECT COALESCE(SUM(ROUND((total - "allocatedAmount") * "exchangeRate", 2)), 0) FROM "CreditNote" WHERE status = 'POSTED'))::text AS ar_sl,
        (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM "JournalLine" l JOIN "AccountDefault" d ON d."accountId" = l."accountId" AND d.key = 'AP' WHERE l.posted AND l."partyType" = 'SUPPLIER')::text AS ap_gl,
        ((SELECT COALESCE(SUM(ROUND((total - "paidAmount") * "exchangeRate", 2)), 0) FROM "PurchaseInvoice" WHERE status IN ('POSTED','PARTIALLY_PAID','PAID'))
          - (SELECT COALESCE(SUM(ROUND((amount - "allocatedAmount") * "exchangeRate", 2)), 0) FROM "SupplierPayment")
          - (SELECT COALESCE(SUM(ROUND((total - "allocatedAmount") * "exchangeRate", 2)), 0) FROM "DebitNote" WHERE status = 'POSTED'))::text AS ap_sl`;
    expect(Number(r.ar_gl)).toBeCloseTo(Number(r.ar_sl), 1);
    expect(Number(r.ap_gl)).toBeCloseTo(Number(r.ap_sl), 1);
    const gm: Ctx = await ctxFor("GENERAL_MANAGER");
    for (const k of ["customer-aging", "supplier-aging", "tax-summary"]) {
      const res = await runReport(gm, k, {});
      expect(res?.result.columns.length).toBeGreaterThan(2);
    }
  });
});
