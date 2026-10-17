import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  saveQuotation, quotationAction, convertQuotationToOrder, saveSalesOrder, salesOrderAction, orderAvailability,
  reserveOrderStock, createDelivery, postDelivery, purchaseRequestFromShortage, reviseQuotation,
} from "@/server/services/sales";
import { ctxFor, superCtx, makeCustomer, makeItem, makeWarehouse, openingBalance, stock, ledgerCount } from "./helpers";

async function approvedOrder(qty: string, onHandQty: string) {
  const admin = await superCtx();
  const officer = await ctxFor("SALES_OFFICER");
  const manager = await ctxFor("SALES_MANAGER");
  const customer = await makeCustomer(admin);
  const item = await makeItem(admin);
  const wh = await makeWarehouse();
  if (Number(onHandQty) > 0) await openingBalance(item.id, wh.id, onHandQty);
  const so = await saveSalesOrder(officer, null, {
    customerId: customer.id, warehouseId: wh.id, lines: [{ itemId: item.id, description: item.name, quantity: qty, unitPrice: "100" }],
  });
  await salesOrderAction(officer, so.id, "submit");
  await salesOrderAction(manager, so.id, "approve");
  return { so, item, wh, officer, manager, customer };
}

describe("Sales workflow", () => {
  it("runs quotation Draft → Submitted → Approved → Sent → Accepted → Converted with link kept", async () => {
    const admin = await superCtx();
    const officer = await ctxFor("SALES_OFFICER");
    const manager = await ctxFor("SALES_MANAGER");
    const customer = await makeCustomer(admin);
    const item = await makeItem(admin);
    const wh = await makeWarehouse();
    const q = await saveQuotation(officer, null, {
      customerId: customer.id, lines: [{ itemId: item.id, description: "Demulsifier", quantity: "4", unitPrice: "250", discountPct: "10", taxRate: "0" }],
    });
    expect(Number(q.total)).toBe(900);
    await quotationAction(officer, q.id, "submit");
    await expect(quotationAction(officer, q.id, "approve")).rejects.toThrow(/permission/i);
    await quotationAction(manager, q.id, "approve");
    await quotationAction(officer, q.id, "send");
    await quotationAction(officer, q.id, "accept");
    const so = await convertQuotationToOrder(officer, q.id, wh.id);
    expect(so.quotationId).toBe(q.id);
    expect(Number(so.total)).toBe(900);
    expect((await prisma.salesQuotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("CONVERTED");
    await expect(convertQuotationToOrder(officer, q.id, wh.id)).rejects.toThrow(/already converted/);
  });

  it("creates a revision and marks the original as revised", async () => {
    const admin = await superCtx();
    const officer = await ctxFor("SALES_OFFICER");
    const customer = await makeCustomer(admin);
    const q = await saveQuotation(officer, null, { customerId: customer.id, lines: [{ description: "Service", quantity: "1", unitPrice: "10" }] });
    await quotationAction(officer, q.id, "submit");
    const r = await reviseQuotation(officer, q.id);
    expect(r.number).toBe(`${q.number}-R1`);
    expect(r.parentId).toBe(q.id);
    expect((await prisma.salesQuotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("REVISED");
  });

  it("[T11] blocks self-approval and approval without permission", async () => {
    const admin = await superCtx();
    const manager = await ctxFor("SALES_MANAGER");
    const keeper = await ctxFor("STOREKEEPER");
    const customer = await makeCustomer(admin);
    const so = await saveSalesOrder(manager, null, { customerId: customer.id, warehouseId: (await makeWarehouse()).id, lines: [{ description: "X", quantity: "1", unitPrice: "1" }] });
    await salesOrderAction(manager, so.id, "submit");
    await expect(salesOrderAction(manager, so.id, "approve")).rejects.toThrow(/Separation of duties/);
    await expect(salesOrderAction(keeper, so.id, "approve")).rejects.toThrow(/permission/i);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("SUBMITTED");
  });

  it("enforces the sales manager's approval limit", async () => {
    const admin = await superCtx();
    const officer = await ctxFor("SALES_OFFICER");
    const manager = await ctxFor("SALES_MANAGER"); // QAR 500,000
    const gm = await ctxFor("GENERAL_MANAGER");
    const customer = await makeCustomer(admin);
    const so = await saveSalesOrder(officer, null, { customerId: customer.id, warehouseId: (await makeWarehouse()).id, lines: [{ description: "Big job", quantity: "1", unitPrice: "750000" }] });
    await salesOrderAction(officer, so.id, "submit");
    await expect(salesOrderAction(manager, so.id, "approve")).rejects.toThrow(/approval limit/);
    await salesOrderAction(gm, so.id, "approve");
  });

  it("[T4] calculates stock availability and shortage for a sales order", async () => {
    const { so } = await approvedOrder("30", "20");
    const av = await orderAvailability(prisma, so.id);
    expect(Number(av[0].onHand)).toBe(20);
    expect(Number(av[0].available)).toBe(20);
    expect(Number(av[0].shortage)).toBe(10);
  });

  it("[T5] reserving stock reduces available quantity but not on-hand", async () => {
    const { so, item, wh, officer } = await approvedOrder("15", "20");
    const r = await reserveOrderStock(officer, so.id);
    expect(r.reserved).toBe("15");
    expect(await stock(item.id, wh.id)).toBe(20);
    const av = await orderAvailability(prisma, so.id);
    expect(Number(av[0].available)).toBe(5);
    expect(Number(av[0].reservedForLine)).toBe(15);
    expect(await ledgerCount({ itemId: item.id, type: "ISSUE_DELIVERY" })).toBe(0);
  });

  it("[T6][T13] posting a delivery reduces on-hand exactly once, even on duplicate submission", async () => {
    const { so, item, wh, officer } = await approvedOrder("10", "25");
    await reserveOrderStock(officer, so.id);
    const keeper = await ctxFor("STOREKEEPER");
    const line = await prisma.salesOrderLine.findFirstOrThrow({ where: { orderId: so.id } });
    const dlv = await createDelivery(keeper, { salesOrderId: so.id, lines: [{ salesOrderLineId: line.id, quantity: "10" }] });
    const results = await Promise.allSettled([postDelivery(keeper, dlv.id), postDelivery(keeper, dlv.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stock(item.id, wh.id)).toBe(15);
    expect(await ledgerCount({ refDocId: dlv.id })).toBe(1);
    const after = await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { lines: true } });
    expect(after.status).toBe("DELIVERED");
    expect(Number(after.lines[0].deliveredQty)).toBe(10);
    const res = await prisma.stockReservation.findMany({ where: { salesOrderLineId: line.id } });
    expect(res.every((r) => r.status !== "ACTIVE")).toBe(true);
  });

  it("supports partial deliveries and prevents over-delivery", async () => {
    const { so, wh, item } = await approvedOrder("10", "25");
    const keeper = await ctxFor("STOREKEEPER");
    const line = await prisma.salesOrderLine.findFirstOrThrow({ where: { orderId: so.id } });
    const d1 = await createDelivery(keeper, { salesOrderId: so.id, lines: [{ salesOrderLineId: line.id, quantity: "4" }] });
    await postDelivery(keeper, d1.id);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("PARTIALLY_DELIVERED");
    await expect(createDelivery(keeper, { salesOrderId: so.id, lines: [{ salesOrderLineId: line.id, quantity: "7" }] })).rejects.toThrow(/exceeds/);
    expect(await stock(item.id, wh.id)).toBe(21);
  });

  it("does not let a delivery consume stock reserved for another order", async () => {
    const admin = await superCtx();
    const first = await approvedOrder("8", "10");
    await reserveOrderStock(first.officer, first.so.id);
    // Second order for the same item/warehouse.
    const customer = await makeCustomer(admin);
    const so2 = await saveSalesOrder(first.officer, null, { customerId: customer.id, warehouseId: first.wh.id, lines: [{ itemId: first.item.id, description: "x", quantity: "5", unitPrice: "1" }] });
    await salesOrderAction(first.officer, so2.id, "submit");
    await salesOrderAction(first.manager, so2.id, "approve");
    const keeper = await ctxFor("STOREKEEPER");
    const l2 = await prisma.salesOrderLine.findFirstOrThrow({ where: { orderId: so2.id } });
    const d = await createDelivery(keeper, { salesOrderId: so2.id, lines: [{ salesOrderLineId: l2.id, quantity: "5" }] });
    await expect(postDelivery(keeper, d.id)).rejects.toThrow(/reserved for other orders/);
  });

  it("service lines are delivered without stock movements", async () => {
    const admin = await superCtx();
    const officer = await ctxFor("SALES_OFFICER");
    const manager = await ctxFor("SALES_MANAGER");
    const keeper = await ctxFor("STOREKEEPER");
    const svc = await makeItem(admin, { itemType: "SERVICE" });
    const so = await saveSalesOrder(officer, null, { customerId: (await makeCustomer(admin)).id, warehouseId: (await makeWarehouse()).id, lines: [{ itemId: svc.id, description: "Slickline crew", quantity: "3", unitPrice: "5000" }] });
    await salesOrderAction(officer, so.id, "submit");
    await salesOrderAction(manager, so.id, "approve");
    const line = await prisma.salesOrderLine.findFirstOrThrow({ where: { orderId: so.id } });
    const d = await createDelivery(keeper, { salesOrderId: so.id, lines: [{ salesOrderLineId: line.id, quantity: "3" }] });
    await postDelivery(keeper, d.id);
    expect(await ledgerCount({ refDocId: d.id })).toBe(0);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("DELIVERED");
  });

  it("creates a purchase request for the shortage on a sales order", async () => {
    const { so, officer } = await approvedOrder("30", "12");
    const pr = await purchaseRequestFromShortage(officer, so.id);
    const lines = await prisma.purchaseRequestLine.findMany({ where: { requestId: pr.id } });
    expect(Number(lines[0].quantity)).toBe(18);
    expect(pr.source).toBe("SALES_SHORTAGE");
  });
});
