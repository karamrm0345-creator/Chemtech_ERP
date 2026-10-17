import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createStockDocument, postStockDocument } from "@/server/services/inventory";
import { ctxFor, superCtx, makeItem, makeWarehouse, openingBalance, stock } from "./helpers";

describe("Concurrency", () => {
  it("[T14] concurrent issues never oversell or desynchronise balances", async () => {
    const keeper = await ctxFor("STOREKEEPER");
    const item = await makeItem(await superCtx());
    const wh = await makeWarehouse();
    await openingBalance(item.id, wh.id, "10");
    const docs = await Promise.all(Array.from({ length: 8 }, () =>
      createStockDocument(keeper, { type: "ISSUE", warehouseId: wh.id, reason: "race", lines: [{ itemId: item.id, quantity: "3" }] })));
    const results = await Promise.allSettled(docs.map((d) => postStockDocument(keeper, d.id)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(3); // 3 × 3 = 9 ≤ 10; the 4th would oversell
    expect(await stock(item.id, wh.id)).toBe(1);
    const ledger = await prisma.inventoryTransaction.aggregate({ where: { itemId: item.id, warehouseId: wh.id }, _sum: { quantity: true } });
    expect(Number(ledger._sum.quantity)).toBe(1);
    const last = await prisma.inventoryTransaction.findFirstOrThrow({ where: { itemId: item.id }, orderBy: { seq: "desc" } });
    expect(Number(last.balanceAfter)).toBe(1);
  });

  it("[T14] concurrent receipts and issues keep the weighted average and balance consistent", async () => {
    const admin = await superCtx();
    const keeper = await ctxFor("STOREKEEPER");
    const item = await makeItem(admin);
    const wh = await makeWarehouse();
    await openingBalance(item.id, wh.id, "100", "10");
    const ins = Array.from({ length: 5 }, () => openingBalance(item.id, wh.id, "10", "10"));
    const outs = Array.from({ length: 5 }, async () => {
      const d = await createStockDocument(keeper, { type: "ISSUE", warehouseId: wh.id, reason: "race", lines: [{ itemId: item.id, quantity: "7" }] });
      return postStockDocument(keeper, d.id);
    });
    await Promise.all([...ins, ...outs]);
    expect(await stock(item.id, wh.id)).toBe(100 + 50 - 35);
    const it2 = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(Number(it2.avgCost)).toBe(10);
  });
});
