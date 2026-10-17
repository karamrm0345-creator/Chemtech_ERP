import { z } from "zod";
import type { InvTxnType, Prisma } from "@prisma/client";
import { prisma, withTx, type Tx } from "../db";
import { can, requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { nextNumber } from "../numbering";
import { AppError, NotFoundError } from "../errors";
import { assertCanApprove, recordApproval } from "../approvals";
import { decimalStr, optDate, optId, optStr, reqStr } from "@/lib/validation";
import { D, ZERO, round2 } from "@/lib/decimal";
import { assertStatus, getSettings, lockRow, paging, type ListArgs } from "./common";
import {
  assertAvailable, allocateLots, getOrCreateBatch, isStockItem, lockItems, onHand, parseSerials, postStock,
} from "./inventory-engine";

const stockLine = z.object({
  itemId: reqStr(40),
  quantity: decimalStr.refine((v) => Number(v) !== 0, "Quantity cannot be zero"),
  unitCost: z.preprocess((v) => (v === "" || v == null ? undefined : String(v)), decimalStr.optional()),
  batchNo: optStr(60),
  expiryDate: optDate,
  serialNos: optStr(4000),
  locationId: optId,
  notes: optStr(300),
});

export const stockDocSchema = z.object({
  type: z.enum(["OPENING", "ADJUSTMENT", "TRANSFER", "ISSUE"]),
  date: optDate,
  warehouseId: reqStr(40),
  toWarehouseId: optId,
  reason: optStr(500),
  reference: optStr(100),
  costCenter: optStr(80),
  lines: z.array(stockLine).min(1, "Add at least one line"),
}).superRefine((d, c) => {
  if (d.type === "TRANSFER") {
    if (!d.toWarehouseId) c.addIssue({ code: "custom", path: ["toWarehouseId"], message: "Destination warehouse is required" });
    if (d.toWarehouseId === d.warehouseId) c.addIssue({ code: "custom", path: ["toWarehouseId"], message: "Destination must differ from source" });
  }
  if (d.type !== "ADJUSTMENT") d.lines.forEach((l, i) => {
    if (Number(l.quantity) < 0) c.addIssue({ code: "custom", path: ["lines", i, "quantity"], message: "Must be positive" });
  });
  if (d.type === "ADJUSTMENT" && !d.reason) c.addIssue({ code: "custom", path: ["reason"], message: "A reason is required for adjustments" });
});

const createPerm = { OPENING: "inventory.adjust", ADJUSTMENT: "inventory.adjust", TRANSFER: "inventory.transfer", ISSUE: "inventory.issue" } as const;

export async function createStockDocument(ctx: Ctx, raw: unknown) {
  const d = stockDocSchema.parse(raw);
  requirePerm(ctx, createPerm[d.type]);
  return withTx(async (tx) => {
    const items = await tx.item.findMany({ where: { id: { in: d.lines.map((l) => l.itemId) } } });
    for (const l of d.lines) {
      const it = items.find((i) => i.id === l.itemId);
      if (!it) throw new AppError("Unknown item in lines.");
      if (!isStockItem(it)) throw new AppError(`${it.code} is a service/non-stock item.`);
    }
    const number = await nextNumber(tx, "STOCK_DOCUMENT");
    const doc = await tx.stockDocument.create({
      data: {
        number, type: d.type, date: d.date ?? new Date(), warehouseId: d.warehouseId, toWarehouseId: d.toWarehouseId,
        reason: d.reason, reference: d.reference, costCenter: d.costCenter, createdById: ctx.userId,
        lines: { create: d.lines.map((l, i) => ({ ...l, lineNo: i + 1 })) },
      },
    });
    await audit(tx, ctx, { action: "CREATE", entity: "StockDocument", entityId: doc.id, summary: `Created ${d.type.toLowerCase()} ${number}` });
    return doc;
  });
}

/**
 * Posts a stock document. Opening balances and adjustments require an
 * approver other than the preparer (inventory.adjust.approve + value limit);
 * transfers and internal issues are posted by authorized store users.
 */
export async function postStockDocument(ctx: Ctx, id: string) {
  return withTx(async (tx) => {
    await lockRow(tx, "StockDocument", id);
    const doc = await tx.stockDocument.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    assertStatus(doc.status, ["DRAFT", "SUBMITTED"], "post");
    const settings = await getSettings(tx);
    await lockItems(tx, doc.lines.map((l) => l.itemId));
    const items = new Map((await tx.item.findMany({ where: { id: { in: doc.lines.map((l) => l.itemId) } } })).map((i) => [i.id, i]));

    if (doc.type === "OPENING" || doc.type === "ADJUSTMENT") {
      let value = ZERO;
      for (const l of doc.lines) value = value.add(D(l.quantity).abs().mul(D(l.unitCost ?? items.get(l.itemId)!.avgCost)));
      await assertCanApprove(tx, ctx, { docType: "STOCK_ADJUSTMENT", permission: "inventory.adjust.approve", createdById: doc.createdById, amountBase: round2(value) });
    } else {
      requirePerm(ctx, createPerm[doc.type]);
    }
    const allowNegative = settings.allowNegativeStock && can(ctx, "inventory.negative");
    const ref = (lineId: string) => ({ docType: "StockDocument", docId: doc.id, docNo: doc.number, lineId });

    for (const l of doc.lines) {
      const item = items.get(l.itemId)!;
      const qty = D(l.quantity);
      const serials = parseSerials(l.serialNos);
      if (qty.gt(0) && (doc.type === "OPENING" || doc.type === "ADJUSTMENT")) {
        if (item.expiryTracked && !l.expiryDate && l.batchNo) {
          const b = await tx.batch.findUnique({ where: { itemId_batchNo: { itemId: item.id, batchNo: l.batchNo } } });
          if (!b?.expiryDate) throw new AppError(`${item.code} requires an expiry date.`);
        }
        const batch = l.batchNo ? await getOrCreateBatch(tx, item.id, l.batchNo, { expiryDate: l.expiryDate }) : null;
        await postStock(tx, ctx, {
          type: doc.type === "OPENING" ? "OPENING" : "ADJUSTMENT_IN", itemId: item.id, warehouseId: doc.warehouseId,
          quantity: qty, unitCost: l.unitCost != null ? D(l.unitCost) : D(item.avgCost), updatesAvgCost: l.unitCost != null,
          batchId: batch?.id, serialNos: serials, locationId: l.locationId, ref: ref(l.id), notes: doc.reason, txnDate: doc.date,
        });
        continue;
      }
      // Outbound: adjustment-out, issue, transfer.
      const outQty = qty.abs();
      await assertAvailable(tx, item.id, doc.warehouseId, outQty, { allowNegative, itemCode: item.code });
      const outType: InvTxnType = doc.type === "TRANSFER" ? "TRANSFER_OUT" : doc.type === "ISSUE" ? "ISSUE_INTERNAL" : "ADJUSTMENT_OUT";
      const lots = item.serialTracked
        ? await lotsFromSerials(tx, item.id, serials)
        : await allocateLots(tx, item.id, doc.warehouseId, outQty, l.batchNo);
      for (const lot of lots) {
        const lotSerials = item.serialTracked ? (lot as { serials?: string[] }).serials ?? [] : [];
        const out = await postStock(tx, ctx, {
          type: outType, itemId: item.id, warehouseId: doc.warehouseId, quantity: lot.quantity.neg(), batchId: lot.batchId,
          serialNos: lotSerials, serialOutStatus: "SCRAPPED", ref: ref(l.id), notes: doc.reason, allowNegative, txnDate: doc.date,
        });
        if (doc.type === "TRANSFER" && out) {
          await postStock(tx, ctx, {
            type: "TRANSFER_IN", itemId: item.id, warehouseId: doc.toWarehouseId!, quantity: lot.quantity, unitCost: D(out.unitCost),
            batchId: lot.batchId, serialNos: lotSerials, locationId: l.locationId, ref: ref(l.id), notes: doc.reason, txnDate: doc.date,
          });
        }
      }
    }
    const posted = await tx.stockDocument.update({
      where: { id }, data: { status: "POSTED", postedById: ctx.userId, postedAt: new Date(), approvedById: ctx.userId },
    });
    await recordApproval(tx, ctx, { docType: "STOCK_DOCUMENT", docId: id, docNo: doc.number, action: "POST" });
    await audit(tx, ctx, { action: "POST", entity: "StockDocument", entityId: id, summary: `Posted ${doc.type.toLowerCase()} ${doc.number}` });
    return posted;
  });
}

async function lotsFromSerials(tx: Tx, itemId: string, serials: string[]) {
  const recs = await tx.serialNumber.findMany({ where: { itemId, serialNo: { in: serials } } });
  const groups = new Map<string, string[]>();
  for (const s of serials) {
    const r = recs.find((x) => x.serialNo === s);
    const k = r?.batchId ?? "";
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return [...groups.entries()].map(([k, list]) => ({ batchId: k || null, quantity: D(list.length), serials: list }));
}

export async function cancelStockDocument(ctx: Ctx, id: string) {
  return withTx(async (tx) => {
    await lockRow(tx, "StockDocument", id);
    const doc = await tx.stockDocument.findUniqueOrThrow({ where: { id } });
    requirePerm(ctx, createPerm[doc.type]);
    assertStatus(doc.status, ["DRAFT", "SUBMITTED"], "cancel");
    await tx.stockDocument.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, { action: "CANCEL", entity: "StockDocument", entityId: id, summary: `Cancelled ${doc.number}` });
  });
}

/**
 * Reverses a posted stock document by writing compensating ledger rows.
 * The original rows are never modified.
 */
export async function reverseStockDocument(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "inventory.adjust.approve");
  if (!reason?.trim()) throw new AppError("A reversal reason is required.");
  return withTx(async (tx) => {
    await lockRow(tx, "StockDocument", id);
    const doc = await tx.stockDocument.findUniqueOrThrow({ where: { id } });
    assertStatus(doc.status, ["POSTED"], "reverse");
    // Undo inbound rows first (e.g. the TRANSFER_IN side) so stock and serials are freed before re-adding at the source.
    const rows = (await tx.inventoryTransaction.findMany({ where: { refDocType: "StockDocument", refDocId: id, type: { not: "REVERSAL" } }, orderBy: { seq: "asc" } }))
      .sort((a, b) => D(b.quantity).cmp(D(a.quantity)));
    await lockItems(tx, rows.map((r) => r.itemId));
    for (const r of rows) {
      const serials = parseSerials(r.serialNos);
      await postStock(tx, ctx, {
        type: "REVERSAL", itemId: r.itemId, warehouseId: r.warehouseId, quantity: D(r.quantity).neg(), unitCost: D(r.unitCost),
        batchId: r.batchId, serialNos: serials, serialOutStatus: "SCRAPPED",
        ref: { docType: "StockDocument", docId: id, docNo: `${doc.number}-REV`, lineId: r.refLineId }, notes: `Reversal: ${reason}`,
      });
    }
    await tx.stockDocument.update({ where: { id }, data: { status: "REVERSED", reversedById: ctx.userId } });
    await audit(tx, ctx, { action: "REVERSE", entity: "StockDocument", entityId: id, summary: `Reversed ${doc.number}: ${reason}` });
  });
}

// ── Physical counts ──

export async function createStockCount(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "inventory.count");
  const d = z.object({ warehouseId: reqStr(40), categoryId: optId, notes: optStr(500) }).parse(raw);
  return withTx(async (tx) => {
    const balances = await tx.stockBalance.findMany({
      where: { warehouseId: d.warehouseId, item: { active: true, ...(d.categoryId ? { categoryId: d.categoryId } : {}) } },
      include: { item: true },
    });
    const items = await tx.item.findMany({
      where: { active: true, inventoryClass: { not: "NON_STOCK" }, itemType: { not: "SERVICE" }, ...(d.categoryId ? { categoryId: d.categoryId } : {}) },
      select: { id: true },
    });
    const lines = balances.filter((b) => !D(b.quantity).isZero()).map((b) => ({ itemId: b.itemId, batchId: b.batchId, systemQty: b.quantity }));
    const covered = new Set(lines.map((l) => l.itemId));
    for (const it of items) if (!covered.has(it.id)) lines.push({ itemId: it.id, batchId: null, systemQty: D(0) });
    const number = await nextNumber(tx, "STOCK_COUNT");
    const c = await tx.stockCount.create({
      data: { number, warehouseId: d.warehouseId, notes: d.notes, createdById: ctx.userId, lines: { create: lines } },
    });
    await audit(tx, ctx, { action: "CREATE", entity: "StockCount", entityId: c.id, summary: `Started count ${number}` });
    return c;
  });
}

export async function saveCountQuantities(ctx: Ctx, countId: string, entries: { lineId: string; countedQty: string | null }[]) {
  requirePerm(ctx, "inventory.count");
  return withTx(async (tx) => {
    await lockRow(tx, "StockCount", countId);
    const c = await tx.stockCount.findUniqueOrThrow({ where: { id: countId } });
    assertStatus(c.status, ["DRAFT"], "edit count");
    for (const e of entries) {
      const v = e.countedQty === null || e.countedQty === "" ? null : D(decimalStr.parse(e.countedQty));
      if (v && v.lt(0)) throw new AppError("Counted quantity cannot be negative.");
      await tx.stockCountLine.updateMany({ where: { id: e.lineId, countId }, data: { countedQty: v } });
    }
  });
}

/** Posts count variances as COUNT_GAIN / COUNT_LOSS ledger rows (needs adjustment approval). */
export async function postStockCount(ctx: Ctx, countId: string) {
  return withTx(async (tx) => {
    await lockRow(tx, "StockCount", countId);
    const c = await tx.stockCount.findUniqueOrThrow({ where: { id: countId }, include: { lines: true } });
    assertStatus(c.status, ["DRAFT"], "post count");
    const counted = c.lines.filter((l) => l.countedQty !== null);
    if (!counted.length) throw new AppError("Enter at least one counted quantity.");
    await lockItems(tx, counted.map((l) => l.itemId));
    const items = new Map((await tx.item.findMany({ where: { id: { in: counted.map((l) => l.itemId) } } })).map((i) => [i.id, i]));
    let value = ZERO;
    const moves: { line: (typeof counted)[number]; variance: Prisma.Decimal }[] = [];
    for (const l of counted) {
      // Compare against the CURRENT balance so movements during the count are respected.
      const bal = await tx.stockBalance.findUnique({ where: { itemId_warehouseId_lotKey: { itemId: l.itemId, warehouseId: c.warehouseId, lotKey: l.batchId ?? "" } } });
      const variance = D(l.countedQty).sub(D(bal?.quantity));
      if (!variance.isZero()) {
        moves.push({ line: l, variance });
        value = value.add(variance.abs().mul(D(items.get(l.itemId)!.avgCost)));
      }
    }
    await assertCanApprove(tx, ctx, { docType: "STOCK_ADJUSTMENT", permission: "inventory.adjust.approve", createdById: c.createdById, amountBase: round2(value) });
    for (const { line, variance } of moves) {
      const item = items.get(line.itemId)!;
      if (item.serialTracked) throw new AppError(`${item.code} is serial-tracked; correct it with an adjustment listing serial numbers.`);
      await postStock(tx, ctx, {
        type: variance.gt(0) ? "COUNT_GAIN" : "COUNT_LOSS", itemId: line.itemId, warehouseId: c.warehouseId, quantity: variance,
        unitCost: D(item.avgCost), batchId: line.batchId, ref: { docType: "StockCount", docId: c.id, docNo: c.number, lineId: line.id },
        notes: "Physical count variance",
      });
    }
    await tx.stockCount.update({ where: { id: countId }, data: { status: "POSTED", postedById: ctx.userId, postedAt: new Date() } });
    await audit(tx, ctx, { action: "POST", entity: "StockCount", entityId: countId, summary: `Posted count ${c.number} with ${moves.length} variance(s)` });
    return { variances: moves.length };
  });
}

// ── Queries ──

export async function listLedger(ctx: Ctx, a: ListArgs & { itemId?: string; warehouseId?: string; type?: string; from?: Date; to?: Date }) {
  requirePerm(ctx, "inventory.view");
  const where: Prisma.InventoryTransactionWhereInput = {
    ...(a.itemId ? { itemId: a.itemId } : {}),
    ...(a.warehouseId ? { warehouseId: a.warehouseId } : {}),
    ...(a.type ? { type: a.type as never } : {}),
    ...(a.from || a.to ? { txnDate: { ...(a.from ? { gte: a.from } : {}), ...(a.to ? { lte: a.to } : {}) } } : {}),
    ...(a.q ? { OR: [{ refDocNo: { contains: a.q, mode: "insensitive" } }, { item: { code: { contains: a.q, mode: "insensitive" } } }, { item: { name: { contains: a.q, mode: "insensitive" } } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({ where, skip, take, orderBy: [{ txnDate: "desc" }, { seq: "desc" }], include: { item: { select: { code: true, name: true } } } }),
    prisma.inventoryTransaction.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

/** Per-item stock position across warehouses (on hand / reserved / available / on order). */
export async function itemStockPosition(itemId: string) {
  const [balances, reservations, poLines, warehouses] = await Promise.all([
    prisma.stockBalance.findMany({ where: { itemId }, include: { batch: true } }),
    prisma.stockReservation.groupBy({ by: ["warehouseId"], where: { itemId, status: "ACTIVE" }, _sum: { quantity: true } }),
    prisma.purchaseOrderLine.findMany({
      where: { itemId, order: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } } },
      select: { quantity: true, receivedQty: true, returnedQty: true, order: { select: { warehouseId: true } } },
    }),
    prisma.warehouse.findMany({ orderBy: { code: "asc" } }),
  ]);
  return warehouses.map((w) => {
    const oh = balances.filter((b) => b.warehouseId === w.id).reduce((s, b) => s.add(D(b.quantity)), ZERO);
    const res = D(reservations.find((r) => r.warehouseId === w.id)?._sum.quantity);
    const oo = poLines.filter((l) => l.order.warehouseId === w.id).reduce((s, l) => {
      const o = D(l.quantity).sub(D(l.receivedQty).sub(D(l.returnedQty)));
      return o.gt(0) ? s.add(o) : s;
    }, ZERO);
    return {
      warehouse: w, onHand: oh, reserved: res, available: oh.sub(res), onOrder: oo,
      lots: balances.filter((b) => b.warehouseId === w.id && !D(b.quantity).isZero()),
    };
  }).filter((r) => !r.onHand.isZero() || !r.reserved.isZero() || !r.onOrder.isZero() || r.warehouse.active);
}

export async function stockOnHandReport(ctx: Ctx, a: { warehouseId?: string; categoryId?: string; q?: string }) {
  requirePerm(ctx, "inventory.view");
  const balances = await prisma.stockBalance.groupBy({
    by: ["itemId", "warehouseId"],
    where: {
      ...(a.warehouseId ? { warehouseId: a.warehouseId } : {}),
      item: { ...(a.categoryId ? { categoryId: a.categoryId } : {}), ...(a.q ? { OR: [{ code: { contains: a.q, mode: "insensitive" } }, { name: { contains: a.q, mode: "insensitive" } }] } : {}) },
    },
    _sum: { quantity: true },
  });
  const items = await prisma.item.findMany({ where: { id: { in: [...new Set(balances.map((b) => b.itemId))] } }, include: { category: true, uom: true } });
  const whs = await prisma.warehouse.findMany();
  const res = await prisma.stockReservation.groupBy({ by: ["itemId", "warehouseId"], where: { status: "ACTIVE" }, _sum: { quantity: true } });
  return balances
    .filter((b) => !D(b._sum.quantity).isZero())
    .map((b) => {
      const item = items.find((i) => i.id === b.itemId)!;
      const qty = D(b._sum.quantity);
      const reserved = D(res.find((r) => r.itemId === b.itemId && r.warehouseId === b.warehouseId)?._sum.quantity);
      return {
        item, warehouse: whs.find((w) => w.id === b.warehouseId)!, onHand: qty, reserved, available: qty.sub(reserved),
        avgCost: D(item.avgCost), value: round2(qty.mul(D(item.avgCost))),
      };
    })
    .sort((x, y) => x.item.code.localeCompare(y.item.code) || x.warehouse.code.localeCompare(y.warehouse.code));
}

export async function getStockDocument(ctx: Ctx, id: string) {
  requirePerm(ctx, "inventory.view");
  const d = await prisma.stockDocument.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  if (!d) throw new NotFoundError("Stock document");
  return d;
}

export { onHand };
