import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  savePurchaseRequest, purchaseRequestAction, createRfq, saveSupplierQuotation, rfqComparison, selectSupplierQuotation,
  savePurchaseOrder, purchaseOrderAction, createGoodsReceipt, postGoodsReceipt, createAndPostPurchaseReturn,
  lowStockSuggestions, purchaseRequestFromLowStock,
} from "@/server/services/purchasing";
import { createStockDocument, postStockDocument } from "@/server/services/inventory";
import { ctxFor, superCtx, makeItem, makeSupplier, makeWarehouse, openingBalance, stock, ledgerCount } from "./helpers";

async function approvedPo(qty: string, opts: { allowPartial?: boolean; freight?: string; unitPrice?: string } = {}) {
  const admin = await superCtx();
  const officer = await ctxFor("PROCUREMENT_OFFICER");
  const manager = await ctxFor("PROCUREMENT_MANAGER");
  const supplier = await makeSupplier(admin);
  const item = await makeItem(admin);
  const wh = await makeWarehouse();
  const po = await savePurchaseOrder(officer, null, {
    supplierId: supplier.id, warehouseId: wh.id, allowPartial: opts.allowPartial ?? true, freight: opts.freight ?? "0",
    lines: [{ itemId: item.id, description: item.name, quantity: qty, unitPrice: opts.unitPrice ?? "20" }],
  });
  await purchaseOrderAction(officer, po.id, "submit");
  await purchaseOrderAction(manager, po.id, "approve");
  const line = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { orderId: po.id } });
  return { po, line, item, wh, supplier, officer, manager };
}

describe("Procurement workflow", () => {
  it("runs PR → approval → RFQ → offers → comparison → selection → PO", async () => {
    const admin = await superCtx();
    const officer = await ctxFor("PROCUREMENT_OFFICER");
    const manager = await ctxFor("PROCUREMENT_MANAGER");
    const item = await makeItem(admin);
    const [s1, s2] = [await makeSupplier(admin), await makeSupplier(admin)];
    const pr = await savePurchaseRequest(officer, null, { justification: "Stock for well testing job", lines: [{ itemId: item.id, description: item.name, quantity: "100", estimatedUnitPrice: "9" }] });
    await purchaseRequestAction(officer, pr.id, "submit");
    await expect(purchaseRequestAction(officer, pr.id, "approve")).rejects.toThrow(/permission/i);
    await purchaseRequestAction(manager, pr.id, "approve");
    const prLine = await prisma.purchaseRequestLine.findFirstOrThrow({ where: { requestId: pr.id } });
    const rfq = await createRfq(officer, { title: "Chemicals", purchaseRequestId: pr.id, supplierIds: [s1.id, s2.id], lines: [{ prLineId: prLine.id, itemId: item.id, description: item.name, quantity: "100" }] });
    const rfqLine = await prisma.rfqLine.findFirstOrThrow({ where: { rfqId: rfq.id } });
    const crit = await prisma.evaluationCriterion.findMany();
    const q1 = await saveSupplierQuotation(officer, null, { rfqId: rfq.id, supplierId: s1.id, deliveryDays: 30, technicalCompliance: "COMPLIANT", lines: [{ rfqLineId: rfqLine.id, itemId: item.id, description: item.name, quantity: "100", unitPrice: "8" }], scores: crit.map((c) => ({ criterionId: c.id, score: 8 })) });
    await saveSupplierQuotation(officer, null, { rfqId: rfq.id, supplierId: s2.id, deliveryDays: 10, currency: "USD", technicalCompliance: "COMPLIANT", lines: [{ rfqLineId: rfqLine.id, itemId: item.id, description: item.name, quantity: "100", unitPrice: "3" }], scores: crit.map((c) => ({ criterionId: c.id, score: 6 })) });
    const cmp = await rfqComparison(rfq.id);
    expect(cmp.quotes).toHaveLength(2);
    expect(cmp.cheapest).toBe(q1.id); // 800 QAR vs 300 USD = 1092 QAR
    expect(cmp.best).toBe(q1.id);
    await selectSupplierQuotation(officer, q1.id);
    expect((await prisma.rfq.findUniqueOrThrow({ where: { id: rfq.id } })).status).toBe("AWARDED");
    const po = await savePurchaseOrder(officer, null, { supplierId: s1.id, supplierQuotationId: q1.id, purchaseRequestId: pr.id, warehouseId: (await makeWarehouse()).id, lines: [{ prLineId: prLine.id, itemId: item.id, description: item.name, quantity: "100", unitPrice: "8" }] });
    await purchaseOrderAction(officer, po.id, "submit");
    await purchaseOrderAction(manager, po.id, "approve");
    expect((await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })).status).toBe("ORDERED");
  });

  it("[T11] prevents unauthorized and self approval of purchase orders", async () => {
    const admin = await superCtx();
    const manager = await ctxFor("PROCUREMENT_MANAGER");
    const keeper = await ctxFor("STOREKEEPER");
    const po = await savePurchaseOrder(manager, null, { supplierId: (await makeSupplier(admin)).id, warehouseId: (await makeWarehouse()).id, lines: [{ description: "Gaskets", quantity: "1", unitPrice: "10" }] });
    await purchaseOrderAction(manager, po.id, "submit");
    await expect(purchaseOrderAction(manager, po.id, "approve")).rejects.toThrow(/Separation of duties/);
    await expect(purchaseOrderAction(keeper, po.id, "approve")).rejects.toThrow(/permission/i);
  });

  it("[T7][T8][T9] partial receipt updates received/outstanding quantities and increases stock once", async () => {
    const { po, line, item, wh } = await approvedPo("100");
    const keeper = await ctxFor("STOREKEEPER");
    const g1 = await createGoodsReceipt(keeper, { purchaseOrderId: po.id, lines: [{ poLineId: line.id, receivedQty: "60" }] });
    await postGoodsReceipt(keeper, g1.id);
    const after1 = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { lines: true } });
    expect(after1.status).toBe("PARTIALLY_RECEIVED");
    expect(Number(after1.lines[0].receivedQty)).toBe(60);
    expect(Number(after1.lines[0].quantity) - Number(after1.lines[0].receivedQty)).toBe(40);
    expect(await stock(item.id, wh.id)).toBe(60);
    expect(await ledgerCount({ refDocId: g1.id })).toBe(1);
    // Duplicate post attempt is refused and does not move stock again.
    await expect(postGoodsReceipt(keeper, g1.id)).rejects.toThrow(/status is posted/);
    expect(await stock(item.id, wh.id)).toBe(60);
    const g2 = await createGoodsReceipt(keeper, { purchaseOrderId: po.id, lines: [{ poLineId: line.id, receivedQty: "40" }] });
    await postGoodsReceipt(keeper, g2.id);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");
    expect(await stock(item.id, wh.id)).toBe(100);
  });

  it("[T13] concurrent duplicate GRN posting creates a single stock movement", async () => {
    const { po, line, item, wh } = await approvedPo("10");
    const keeper = await ctxFor("STOREKEEPER");
    const g = await createGoodsReceipt(keeper, { purchaseOrderId: po.id, lines: [{ poLineId: line.id, receivedQty: "10" }] });
    const r = await Promise.allSettled([postGoodsReceipt(keeper, g.id), postGoodsReceipt(keeper, g.id), postGoodsReceipt(keeper, g.id)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await ledgerCount({ refDocId: g.id })).toBe(1);
    expect(await stock(item.id, wh.id)).toBe(10);
  });

  it("blocks over-receipt beyond tolerance and records rejected quantities as nonconformities", async () => {
    const { po, line, item, wh, supplier } = await approvedPo("10");
    const keeper = await ctxFor("STOREKEEPER");
    await expect(createGoodsReceipt(keeper, { purchaseOrderId: po.id, lines: [{ poLineId: line.id, receivedQty: "11" }] })).rejects.toThrow(/exceeds/);
    const g = await createGoodsReceipt(keeper, { purchaseOrderId: po.id, lines: [{ poLineId: line.id, receivedQty: "10", rejectedQty: "2", rejectionReason: "Damaged drums" }] });
    await postGoodsReceipt(keeper, g.id);
    expect(await stock(item.id, wh.id)).toBe(8);
    const pol = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(pol.receivedQty)).toBe(8);
    expect(await prisma.supplierIssue.count({ where: { supplierId: supplier.id, goodsReceiptId: g.id } })).toBe(1);
  });

  it("refuses partial receipt when the PO does not allow it (unless an approver posts)", async () => {
    const { po, line } = await approvedPo("10", { allowPartial: false });
    const keeper = await ctxFor("STOREKEEPER");
    const g = await createGoodsReceipt(keeper, { purchaseOrderId: po.id, lines: [{ poLineId: line.id, receivedQty: "5" }] });
    await expect(postGoodsReceipt(keeper, g.id)).rejects.toThrow(/partial/);
  });

  it("values receipts at landed cost (freight allocated) using weighted average", async () => {
    const { po, line, item } = await approvedPo("10", { freight: "50", unitPrice: "20" });
    const keeper = await ctxFor("STOREKEEPER");
    const g = await createGoodsReceipt(keeper, { purchaseOrderId: po.id, lines: [{ poLineId: line.id, receivedQty: "10" }] });
    await postGoodsReceipt(keeper, g.id);
    const it = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(Number(it.avgCost)).toBe(25); // (200 + 50) / 10
  });

  it("returns goods to supplier, reducing stock and increasing outstanding", async () => {
    const { po, line, item, wh, manager } = await approvedPo("10");
    const keeper = await ctxFor("STOREKEEPER");
    const g = await createGoodsReceipt(keeper, { purchaseOrderId: po.id, lines: [{ poLineId: line.id, receivedQty: "10" }] });
    await postGoodsReceipt(keeper, g.id);
    await createAndPostPurchaseReturn(manager, { purchaseOrderId: po.id, goodsReceiptId: g.id, reason: "Wrong grade", lines: [{ poLineId: line.id, quantity: "3" }] });
    expect(await stock(item.id, wh.id)).toBe(7);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PARTIALLY_RECEIVED");
  });

  it("[T10] raises a low-stock alert at the reorder threshold and builds a PR from it", async () => {
    const admin = await superCtx();
    const keeper = await ctxFor("STOREKEEPER");
    const officer = await ctxFor("PROCUREMENT_OFFICER");
    const item = await makeItem(admin, { minStockLevel: "20", reorderQty: "50" });
    const wh = await makeWarehouse();
    await openingBalance(item.id, wh.id, "25");
    const listed = async () => (await lowStockSuggestions(prisma)).some((s) => s.item.id === item.id);
    expect(await listed()).toBe(false); // 25 > 20
    const issue = await createStockDocument(keeper, { type: "ISSUE", warehouseId: wh.id, reason: "Job", lines: [{ itemId: item.id, quantity: "5" }] });
    await postStockDocument(keeper, issue.id);
    expect(await listed()).toBe(true); // 20 <= 20
    const pr = await purchaseRequestFromLowStock(officer, [item.id]);
    const l = await prisma.purchaseRequestLine.findFirstOrThrow({ where: { requestId: pr.id } });
    expect(Number(l.quantity)).toBe(50);
    expect(pr.status).toBe("DRAFT");
  });
});
