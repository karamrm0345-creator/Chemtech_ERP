import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getKpis, getCharts, inventoryStatus } from "@/server/services/dashboard";
import { saveSalesOrder, salesOrderAction, createDelivery, postDelivery } from "@/server/services/sales";
import { createSalesInvoice, postSalesInvoice, recordCustomerPayment } from "@/server/services/finance";
import { savePurchaseOrder, purchaseOrderAction } from "@/server/services/purchasing";
import { ctxFor, superCtx, makeCustomer, makeItem, makeSupplier, makeWarehouse, openingBalance } from "./helpers";

describe("Dashboard", () => {
  it("[T12] KPI figures match the underlying database records", async () => {
    const admin = await superCtx();
    const gm = await ctxFor("GENERAL_MANAGER");
    const officer = await ctxFor("SALES_OFFICER");
    const finance = await ctxFor("FINANCE_OFFICER");
    const keeper = await ctxFor("STOREKEEPER");
    const customer = await makeCustomer(admin);
    const item = await makeItem(admin, { minStockLevel: "5" });
    const wh = await makeWarehouse();
    await openingBalance(item.id, wh.id, "10", "40");
    const from = new Date(Date.now() - 86_400_000), to = new Date(Date.now() + 86_400_000);
    const before = await getKpis(gm, { from, to, customerId: customer.id });
    expect(before.confirmedRevenue.value).toBe(0);
    expect(before.orderIntake.value).toBe(0);

    const so = await saveSalesOrder(officer, null, { customerId: customer.id, warehouseId: wh.id, lines: [{ itemId: item.id, description: "x", quantity: "6", unitPrice: "100", discountPct: "10" }] });
    await salesOrderAction(officer, so.id, "submit");
    const mid = await getKpis(gm, { from, to, customerId: customer.id });
    expect(mid.orderIntake.value).toBe(0); // not yet approved
    await salesOrderAction(gm, so.id, "approve");
    const line = await prisma.salesOrderLine.findFirstOrThrow({ where: { orderId: so.id } });
    const d = await createDelivery(keeper, { salesOrderId: so.id, lines: [{ salesOrderLineId: line.id, quantity: "6" }] });
    await postDelivery(keeper, d.id);
    const k1 = await getKpis(gm, { from, to, customerId: customer.id });
    expect(k1.orderIntake.value).toBe(540);
    expect(k1.deliveredValue).toBe(540);
    expect(k1.confirmedRevenue.value).toBe(0); // orders are not revenue

    const inv = await createSalesInvoice(finance, { salesOrderId: so.id, lines: [{ salesOrderLineId: line.id, quantity: "6" }] });
    await postSalesInvoice(finance, inv.id);
    await recordCustomerPayment(finance, { invoiceId: inv.id, amount: "140" });
    const k2 = await getKpis(gm, { from, to, customerId: customer.id });
    expect(k2.confirmedRevenue.value).toBe(540);
    expect(k2.finance?.receivables).toBe(400);

    // Inventory valuation equals Σ(on hand × avg cost) computed directly.
    const rows = await prisma.$queryRaw<{ v: number }[]>`
      SELECT COALESCE(SUM(b.quantity * i."avgCost"), 0)::float v FROM "StockBalance" b JOIN "Item" i ON i.id = b."itemId"
      WHERE i.active AND i."inventoryClass" <> 'NON_STOCK' AND i."itemType" <> 'SERVICE'`;
    const status = await inventoryStatus();
    expect(status.value).toBeCloseTo(rows[0].v, 2);
    expect(k2.lowStock).toBeGreaterThanOrEqual(1); // 4 on hand ≤ min 5

    // Purchases KPI counts approved POs only.
    const sup = await makeSupplier(admin);
    const po = await savePurchaseOrder(officer.permissions.has("purchase.order.manage") ? officer : admin, null, { supplierId: sup.id, warehouseId: wh.id, lines: [{ description: "Valves", quantity: "2", unitPrice: "1000" }] });
    const p0 = await getKpis(gm, { from, to, supplierId: sup.id });
    expect(p0.purchases.value).toBe(0);
    await purchaseOrderAction(admin, po.id, "submit");
    await purchaseOrderAction(gm, po.id, "approve");
    const p1 = await getKpis(gm, { from, to, supplierId: sup.id });
    expect(p1.purchases.value).toBe(2000);

    const charts = await getCharts(gm, { from, to, customerId: customer.id });
    expect(charts.salesByCustomer[0]).toMatchObject({ id: customer.id, value: 540 });
    expect(charts.monthly.reduce((s, m) => s + m.invoiced, 0)).toBe(540);
  });

  it("hides the dashboard from users without the executive permission", async () => {
    const keeper = await ctxFor("STOREKEEPER");
    await expect(getKpis(keeper, { from: new Date(0), to: new Date() })).rejects.toThrow(/permission/i);
  });

  it("hides financial KPIs from users without dashboard.financial", async () => {
    const sm = await ctxFor("SALES_MANAGER");
    const k = await getKpis(sm, { from: new Date(0), to: new Date() });
    expect(k.finance).toBeNull();
  });
});
