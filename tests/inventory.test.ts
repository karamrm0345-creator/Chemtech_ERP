import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createStockDocument, postStockDocument, reverseStockDocument, createStockCount, saveCountQuantities, postStockCount } from "@/server/services/inventory";
import { ctxFor, superCtx, makeItem, makeWarehouse, openingBalance, stock, ledgerCount, uid } from "./helpers";

describe("Inventory ledger", () => {
  it("[T3] receives an opening balance through an authorized, approved stock document", async () => {
    const admin = await superCtx();
    const item = await makeItem(admin);
    const wh = await makeWarehouse();
    const doc = await openingBalance(item.id, wh.id, "50", "12.5");
    expect(await stock(item.id, wh.id)).toBe(50);
    const rows = await prisma.inventoryTransaction.findMany({ where: { refDocId: doc.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("OPENING");
    expect(Number(rows[0].totalValue)).toBe(625);
    const it2 = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(Number(it2.avgCost)).toBe(12.5);
  });

  it("enforces separation of duties on adjustments", async () => {
    const mgr = await ctxFor("STORE_MANAGER");
    const item = await makeItem(await superCtx());
    const wh = await makeWarehouse();
    const doc = await createStockDocument(mgr, { type: "OPENING", warehouseId: wh.id, lines: [{ itemId: item.id, quantity: "5", unitCost: "1" }] });
    await expect(postStockDocument(mgr, doc.id)).rejects.toThrow(/Separation of duties/);
  });

  it("enforces approval value limits on adjustments", async () => {
    const keeper = await ctxFor("STOREKEEPER");
    const mgr = await ctxFor("STORE_MANAGER"); // limit QAR 20,000
    const item = await makeItem(await superCtx());
    const wh = await makeWarehouse();
    const doc = await createStockDocument(keeper, { type: "OPENING", warehouseId: wh.id, lines: [{ itemId: item.id, quantity: "1000", unitCost: "50" }] });
    await expect(postStockDocument(mgr, doc.id)).rejects.toThrow(/approval limit/);
    const gm = await ctxFor("GENERAL_MANAGER");
    await postStockDocument(gm, doc.id);
    expect(await stock(item.id, wh.id)).toBe(1000);
  });

  it("prevents negative stock by default", async () => {
    const keeper = await ctxFor("STOREKEEPER");
    const item = await makeItem(await superCtx());
    const wh = await makeWarehouse();
    await openingBalance(item.id, wh.id, "3");
    const issue = await createStockDocument(keeper, { type: "ISSUE", warehouseId: wh.id, reason: "Workshop", lines: [{ itemId: item.id, quantity: "5" }] });
    await expect(postStockDocument(keeper, issue.id)).rejects.toThrow(/Insufficient/);
    expect(await stock(item.id, wh.id)).toBe(3);
  });

  it("transfers stock between warehouses with paired ledger rows and can be reversed", async () => {
    const keeper = await ctxFor("STOREKEEPER");
    const mgr = await ctxFor("STORE_MANAGER");
    const item = await makeItem(await superCtx());
    const a = await makeWarehouse(); const b = await makeWarehouse();
    await openingBalance(item.id, a.id, "20");
    const t = await createStockDocument(keeper, { type: "TRANSFER", warehouseId: a.id, toWarehouseId: b.id, lines: [{ itemId: item.id, quantity: "8" }] });
    await postStockDocument(keeper, t.id);
    expect(await stock(item.id, a.id)).toBe(12);
    expect(await stock(item.id, b.id)).toBe(8);
    expect(await stock(item.id)).toBe(20);
    await reverseStockDocument(mgr, t.id, "Wrong warehouse");
    expect(await stock(item.id, a.id)).toBe(20);
    expect(await stock(item.id, b.id)).toBe(0);
    // Original rows remain; compensating rows were added.
    expect(await ledgerCount({ refDocId: t.id })).toBe(4);
  });

  it("allocates batch stock first-expiry-first-out and requires expiry for expiry-tracked items", async () => {
    const admin = await superCtx();
    const keeper = await ctxFor("STOREKEEPER");
    const item = await makeItem(admin, { itemType: "CHEMICAL", expiryTracked: true });
    const wh = await makeWarehouse();
    await openingBalance(item.id, wh.id, "10", "5", { batchNo: "LATE", expiryDate: "2028-12-31" });
    await openingBalance(item.id, wh.id, "10", "5", { batchNo: "EARLY", expiryDate: "2027-01-31" });
    const issue = await createStockDocument(keeper, { type: "ISSUE", warehouseId: wh.id, reason: "Job", lines: [{ itemId: item.id, quantity: "12" }] });
    await postStockDocument(keeper, issue.id);
    const bals = await prisma.stockBalance.findMany({ where: { itemId: item.id }, include: { batch: true } });
    expect(Number(bals.find((b) => b.batch?.batchNo === "EARLY")!.quantity)).toBe(0);
    expect(Number(bals.find((b) => b.batch?.batchNo === "LATE")!.quantity)).toBe(8);
    await expect(openingBalance(item.id, wh.id, "1", "5", { batchNo: "NOEXP" })).rejects.toThrow(/expiry/);
  });

  it("tracks serial numbers for serialized equipment", async () => {
    const admin = await superCtx();
    const keeper = await ctxFor("STOREKEEPER");
    const item = await makeItem(admin, { itemType: "EQUIPMENT", inventoryClass: "SERIALIZED_ASSET" });
    const wh = await makeWarehouse();
    await expect(openingBalance(item.id, wh.id, "2", "1000", { serialNos: "SN-1" })).rejects.toThrow(/serial/);
    await openingBalance(item.id, wh.id, "2", "1000", { serialNos: "SN-1, SN-2" });
    const issue = await createStockDocument(keeper, { type: "ISSUE", warehouseId: wh.id, reason: "Scrap", lines: [{ itemId: item.id, quantity: "1", serialNos: "SN-2" }] });
    await postStockDocument(keeper, issue.id);
    const sns = await prisma.serialNumber.findMany({ where: { itemId: item.id }, orderBy: { serialNo: "asc" } });
    expect(sns.map((s) => s.status)).toEqual(["IN_STOCK", "SCRAPPED"]);
  });

  it("posts physical count variances against the current balance", async () => {
    const keeper = await ctxFor("STOREKEEPER");
    const mgr = await ctxFor("STORE_MANAGER");
    const item = await makeItem(await superCtx());
    const wh = await makeWarehouse();
    await openingBalance(item.id, wh.id, "40");
    const count = await createStockCount(keeper, { warehouseId: wh.id });
    const line = await prisma.stockCountLine.findFirstOrThrow({ where: { countId: count.id, itemId: item.id } });
    expect(Number(line.systemQty)).toBe(40);
    await saveCountQuantities(keeper, count.id, [{ lineId: line.id, countedQty: "37" }]);
    await postStockCount(mgr, count.id);
    expect(await stock(item.id, wh.id)).toBe(37);
    expect(await ledgerCount({ refDocId: count.id, type: "COUNT_LOSS" })).toBe(1);
  });

  it("keeps StockBalance equal to the sum of the ledger for every item/warehouse", async () => {
    const rows = await prisma.$queryRaw<{ diff: number }[]>`
      SELECT COUNT(*)::int AS diff FROM (
        SELECT b."itemId", b."warehouseId", SUM(b.quantity) AS bal,
          COALESCE((SELECT SUM(t.quantity) FROM "InventoryTransaction" t WHERE t."itemId" = b."itemId" AND t."warehouseId" = b."warehouseId"), 0) AS led
        FROM "StockBalance" b GROUP BY b."itemId", b."warehouseId"
      ) x WHERE x.bal <> x.led`;
    expect(rows[0].diff).toBe(0);
  });

  it("refuses stock movements for service items", async () => {
    const admin = await superCtx();
    const keeper = await ctxFor("STOREKEEPER");
    const svc = await makeItem(admin, { itemType: "SERVICE", code: uid("SV") });
    const wh = await makeWarehouse();
    await expect(createStockDocument(keeper, { type: "OPENING", warehouseId: wh.id, lines: [{ itemId: svc.id, quantity: "1" }] })).rejects.toThrow(/service/);
  });
});
