import { describe, expect, it } from "vitest";
import { prisma, withTx } from "@/server/db";
import { saveSalesOrder, salesOrderAction, reserveOrderStock, createDelivery, postDelivery } from "@/server/services/sales";
import { createSalesInvoice, postSalesInvoice, recordCustomerPayment, createPurchaseInvoice, postPurchaseInvoice, invoiceableLines } from "@/server/services/finance";
import { savePurchaseOrder, purchaseOrderAction, createGoodsReceipt, postGoodsReceipt } from "@/server/services/purchasing";
import { REPORTS, runReport } from "@/server/services/reports";
import { nextNumber } from "@/server/numbering";
import { ctxFor, superCtx, makeCustomer, makeItem, makeSupplier, makeWarehouse, openingBalance, stock } from "./helpers";

describe("Finance rules", () => {
  it("only invoices stocked lines after delivery, prevents over-payment and tracks paid status", async () => {
    const admin = await superCtx();
    const officer = await ctxFor("SALES_OFFICER");
    const mgr = await ctxFor("SALES_MANAGER");
    const fin = await ctxFor("FINANCE_OFFICER");
    const keeper = await ctxFor("STOREKEEPER");
    const item = await makeItem(admin);
    const wh = await makeWarehouse();
    await openingBalance(item.id, wh.id, "10");
    const so = await saveSalesOrder(officer, null, { customerId: (await makeCustomer(admin)).id, warehouseId: wh.id, lines: [{ itemId: item.id, description: "x", quantity: "4", unitPrice: "250" }] });
    await salesOrderAction(officer, so.id, "submit");
    await salesOrderAction(mgr, so.id, "approve");
    const line = await prisma.salesOrderLine.findFirstOrThrow({ where: { orderId: so.id } });
    await expect(createSalesInvoice(fin, { salesOrderId: so.id, lines: [{ salesOrderLineId: line.id, quantity: "4" }] })).rejects.toThrow(/delivered first/);
    const d = await createDelivery(keeper, { salesOrderId: so.id, lines: [{ salesOrderLineId: line.id, quantity: "4" }] });
    await postDelivery(keeper, d.id);
    expect(Number((await invoiceableLines(so.id))[0].invoiceable)).toBe(4);
    const inv = await createSalesInvoice(fin, { salesOrderId: so.id, lines: [{ salesOrderLineId: line.id, quantity: "4" }] });
    expect(Number((await invoiceableLines(so.id))[0].invoiceable)).toBe(0); // draft reserves the quantity
    await postSalesInvoice(fin, inv.id);
    await expect(recordCustomerPayment(fin, { invoiceId: inv.id, amount: "1000.01" })).rejects.toThrow(/exceeds/);
    await recordCustomerPayment(fin, { invoiceId: inv.id, amount: "400" });
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PARTIALLY_PAID");
    await recordCustomerPayment(fin, { invoiceId: inv.id, amount: "600" });
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    await expect(createSalesInvoice(keeper, { salesOrderId: so.id, lines: [] })).rejects.toThrow(/permission/i);
  });

  it("flags 3-way match variances and requires a justification to post", async () => {
    const admin = await superCtx();
    const off = await ctxFor("PROCUREMENT_OFFICER");
    const mgr = await ctxFor("PROCUREMENT_MANAGER");
    const keeper = await ctxFor("STOREKEEPER");
    const fin = await ctxFor("FINANCE_OFFICER");
    const item = await makeItem(admin);
    const po = await savePurchaseOrder(off, null, { supplierId: (await makeSupplier(admin)).id, warehouseId: (await makeWarehouse()).id, lines: [{ itemId: item.id, description: "x", quantity: "10", unitPrice: "20" }] });
    await purchaseOrderAction(off, po.id, "submit");
    await purchaseOrderAction(mgr, po.id, "approve");
    const pol = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { orderId: po.id } });
    const g = await createGoodsReceipt(keeper, { purchaseOrderId: po.id, lines: [{ poLineId: pol.id, receivedQty: "6" }] });
    await postGoodsReceipt(keeper, g.id);
    const ok = await createPurchaseInvoice(fin, { purchaseOrderId: po.id, supplierInvoiceNo: `INV-OK-${po.id}`, lines: [{ poLineId: pol.id, quantity: "6", unitPrice: "20" }] });
    expect(ok.matchStatus).toBe("MATCHED");
    const bad = await createPurchaseInvoice(fin, { purchaseOrderId: po.id, supplierInvoiceNo: `INV-BAD-${po.id}`, lines: [{ poLineId: pol.id, quantity: "4", unitPrice: "22" }] });
    expect(bad.matchStatus).toBe("VARIANCE");
    await expect(postPurchaseInvoice(fin, bad.id)).rejects.toThrow(/variance/i);
    await postPurchaseInvoice(fin, bad.id, "Price increase agreed by email");
    expect((await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: bad.id } })).status).toBe("POSTED");
  });
});

describe("Cancellation rules", () => {
  it("cancelling an order releases its reservations; delivered orders cannot be cancelled", async () => {
    const admin = await superCtx();
    const officer = await ctxFor("SALES_OFFICER");
    const mgr = await ctxFor("SALES_MANAGER");
    const keeper = await ctxFor("STOREKEEPER");
    const item = await makeItem(admin);
    const wh = await makeWarehouse();
    await openingBalance(item.id, wh.id, "10");
    const mk = async () => {
      const so = await saveSalesOrder(officer, null, { customerId: (await makeCustomer(admin)).id, warehouseId: wh.id, lines: [{ itemId: item.id, description: "x", quantity: "3", unitPrice: "1" }] });
      await salesOrderAction(officer, so.id, "submit"); await salesOrderAction(mgr, so.id, "approve"); await reserveOrderStock(officer, so.id);
      return so;
    };
    const a = await mk();
    await salesOrderAction(officer, a.id, "cancel");
    expect(await prisma.stockReservation.count({ where: { salesOrderLine: { orderId: a.id }, status: "ACTIVE" } })).toBe(0);
    const b = await mk();
    const l = await prisma.salesOrderLine.findFirstOrThrow({ where: { orderId: b.id } });
    const d = await createDelivery(keeper, { salesOrderId: b.id, lines: [{ salesOrderLineId: l.id, quantity: "1" }] });
    await postDelivery(keeper, d.id);
    await expect(salesOrderAction(officer, b.id, "cancel")).rejects.toThrow(/Cannot cancel/);
    expect(await stock(item.id, wh.id)).toBe(9);
  });
});

describe("Document numbering", () => {
  it("allocates unique sequential numbers under concurrency", async () => {
    const nums = await Promise.all(Array.from({ length: 20 }, () => withTx((tx) => nextNumber(tx, "STOCK_COUNT"))));
    expect(new Set(nums).size).toBe(20);
    expect(nums.every((n) => /^CNT-\d{4}-\d{5}$/.test(n))).toBe(true);
  });
});

describe("Reports", () => {
  it("every report runs against live data for an authorised role", async () => {
    const gm = await ctxFor("GENERAL_MANAGER");
    for (const r of REPORTS) {
      const out = await runReport(gm, r.key, { from: new Date(Date.now() - 365 * 86_400_000), to: new Date(), days: 90 });
      expect(out?.result.columns.length, r.key).toBeGreaterThan(0);
    }
  });

  it("respects report permissions", async () => {
    const officer = await ctxFor("SALES_OFFICER"); // no reports.view, no audit.view
    await expect(runReport(officer, "audit-trail", {})).rejects.toThrow(/permission/i);
    await expect(runReport(officer, "sales-by-customer", {})).rejects.toThrow(/permission/i);
  });
});
