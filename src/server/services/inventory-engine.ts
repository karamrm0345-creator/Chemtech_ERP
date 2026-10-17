/**
 * Inventory posting engine — the ONLY code that writes stock.
 *
 * Integrity model
 *  - Every quantity change is an immutable InventoryTransaction row (ledger).
 *  - StockBalance (item / warehouse / lot) is updated in the same DB transaction.
 *  - Before touching stock for an item, the caller's transaction takes a row
 *    lock on the Item (SELECT … FOR UPDATE, ids sorted to avoid deadlocks).
 *    All writers for the same item are therefore serialized, which makes the
 *    availability check + write atomic under concurrent users.
 *  - Valuation uses moving weighted-average cost kept on Item.avgCost.
 */
import { Prisma, type InvTxnType, type SerialStatus } from "@prisma/client";
import type { Tx } from "../db";
import type { Ctx } from "../context";
import { AppError } from "../errors";
import { D, ZERO, round2, round4, type Dec } from "@/lib/decimal";
import { fmtQty } from "@/lib/format";

export async function lockItems(tx: Tx, itemIds: (string | null | undefined)[]) {
  const ids = [...new Set(itemIds.filter((x): x is string => !!x))].sort();
  if (!ids.length) return;
  await tx.$queryRaw`SELECT id FROM "Item" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
}

export function isStockItem(item: { itemType: string; inventoryClass: string }) {
  return item.itemType !== "SERVICE" && item.inventoryClass !== "NON_STOCK";
}

export async function onHand(tx: Tx, itemId: string, warehouseId?: string): Promise<Dec> {
  const r = await tx.stockBalance.aggregate({
    where: { itemId, ...(warehouseId ? { warehouseId } : {}) },
    _sum: { quantity: true },
  });
  return D(r._sum.quantity);
}

export async function reservedQty(tx: Tx, itemId: string, warehouseId?: string, excludeSoLineId?: string): Promise<Dec> {
  const r = await tx.stockReservation.aggregate({
    where: {
      itemId, status: "ACTIVE",
      ...(warehouseId ? { warehouseId } : {}),
      ...(excludeSoLineId ? { salesOrderLineId: { not: excludeSoLineId } } : {}),
    },
    _sum: { quantity: true },
  });
  return D(r._sum.quantity);
}

/** Quantity on approved, not yet fully received purchase orders. */
export async function onOrderQty(tx: Tx, itemId: string, warehouseId?: string): Promise<Dec> {
  const lines = await tx.purchaseOrderLine.findMany({
    where: {
      itemId,
      order: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] }, ...(warehouseId ? { warehouseId } : {}) },
    },
    select: { quantity: true, receivedQty: true, returnedQty: true },
  });
  return lines.reduce((s, l) => {
    const out = D(l.quantity).sub(D(l.receivedQty).sub(D(l.returnedQty)));
    return out.gt(0) ? s.add(out) : s;
  }, ZERO);
}

export async function availability(tx: Tx, itemId: string, warehouseId: string) {
  const [oh, res, oo] = await Promise.all([
    onHand(tx, itemId, warehouseId), reservedQty(tx, itemId, warehouseId), onOrderQty(tx, itemId, warehouseId),
  ]);
  return { onHand: oh, reserved: res, available: oh.sub(res), onOrder: oo };
}

export async function getOrCreateBatch(
  tx: Tx, itemId: string, batchNo: string,
  extra: { expiryDate?: Date | null; certificateNo?: string | null } = {},
) {
  const existing = await tx.batch.findUnique({ where: { itemId_batchNo: { itemId, batchNo } } });
  if (existing) {
    if ((extra.expiryDate && !existing.expiryDate) || (extra.certificateNo && !existing.certificateNo)) {
      return tx.batch.update({
        where: { id: existing.id },
        data: { expiryDate: existing.expiryDate ?? extra.expiryDate, certificateNo: existing.certificateNo ?? extra.certificateNo },
      });
    }
    return existing;
  }
  return tx.batch.create({ data: { itemId, batchNo, expiryDate: extra.expiryDate ?? null, certificateNo: extra.certificateNo ?? null } });
}

/** First-expiry-first-out allocation of an outbound quantity across lots. */
export async function allocateLots(
  tx: Tx, itemId: string, warehouseId: string, qty: Dec, batchNo?: string | null,
): Promise<{ batchId: string | null; quantity: Dec }[]> {
  if (batchNo) {
    const b = await tx.batch.findUnique({ where: { itemId_batchNo: { itemId, batchNo } } });
    if (!b) throw new AppError(`Batch ${batchNo} does not exist for this item.`);
    return [{ batchId: b.id, quantity: qty }];
  }
  const balances = await tx.stockBalance.findMany({
    where: { itemId, warehouseId, quantity: { gt: 0 } },
    include: { batch: true },
  });
  balances.sort((a, b) => {
    const ea = a.batch?.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const eb = b.batch?.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ea - eb || (a.batch?.createdAt.getTime() ?? 0) - (b.batch?.createdAt.getTime() ?? 0);
  });
  const out: { batchId: string | null; quantity: Dec }[] = [];
  let remaining = qty;
  for (const b of balances) {
    if (remaining.lte(0)) break;
    const take = Prisma.Decimal.min(remaining, D(b.quantity));
    out.push({ batchId: b.batchId, quantity: take });
    remaining = remaining.sub(take);
  }
  if (remaining.gt(0)) {
    // Let postStock raise the standard insufficient-stock error for the remainder.
    out.push({ batchId: out.at(-1)?.batchId ?? null, quantity: remaining });
  }
  return out;
}

export interface StockMovement {
  type: InvTxnType;
  itemId: string;
  warehouseId: string;
  quantity: Dec; // signed
  unitCost?: Dec | null; // inbound cost in base currency; outbound uses avg cost
  updatesAvgCost?: boolean; // true for purchases / opening / costed adjustments
  batchId?: string | null;
  serialNos?: string[];
  serialOutStatus?: SerialStatus;
  locationId?: string | null;
  ref: { docType: string; docId: string; docNo: string; lineId?: string | null };
  notes?: string | null;
  allowNegative?: boolean;
  txnDate?: Date;
}

export function parseSerials(s: string | null | undefined): string[] {
  if (!s) return [];
  return [...new Set(s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
}

/** Posts one ledger row and updates the balance cache, cost and serials. */
export async function postStock(tx: Tx, ctx: Ctx, m: StockMovement) {
  if (m.quantity.isZero()) return null;
  await lockItems(tx, [m.itemId]); // no-op if the caller already holds the lock
  const item = await tx.item.findUniqueOrThrow({ where: { id: m.itemId } });
  if (!isStockItem(item)) throw new AppError(`${item.code} is a non-stock/service item and has no stock movements.`);
  if (item.batchTracked && !m.batchId && m.quantity.gt(0)) throw new AppError(`${item.code} requires a batch/lot number.`);

  const serials = m.serialNos ?? [];
  if (item.serialTracked) {
    if (!m.quantity.abs().equals(serials.length)) {
      throw new AppError(`${item.code} is serial-tracked: provide exactly ${fmtQty(m.quantity.abs())} serial number(s) (got ${serials.length}).`);
    }
  }

  const lotKey = m.batchId ?? "";
  const bal = await tx.stockBalance.upsert({
    where: { itemId_warehouseId_lotKey: { itemId: m.itemId, warehouseId: m.warehouseId, lotKey } },
    create: { itemId: m.itemId, warehouseId: m.warehouseId, lotKey, batchId: m.batchId ?? null, quantity: 0 },
    update: {},
  });
  const newLotQty = D(bal.quantity).add(m.quantity);
  if (m.quantity.lt(0) && newLotQty.lt(0) && !m.allowNegative) {
    const wh = await tx.warehouse.findUnique({ where: { id: m.warehouseId }, select: { code: true } });
    throw new AppError(
      `Insufficient stock for ${item.code} in ${wh?.code ?? "warehouse"}: on hand ${fmtQty(bal.quantity)}, required ${fmtQty(m.quantity.abs())}.`,
    );
  }

  // Weighted-average cost (company-wide, base currency).
  const totalBefore = await onHand(tx, m.itemId);
  const avg = D(item.avgCost);
  let unitCost = avg;
  let newAvg = avg;
  if (m.quantity.gt(0) && m.unitCost != null) {
    unitCost = D(m.unitCost);
    if (m.updatesAvgCost) {
      const totalAfter = totalBefore.add(m.quantity);
      newAvg = totalBefore.lte(0) || totalAfter.lte(0)
        ? unitCost
        : round4(totalBefore.mul(avg).add(m.quantity.mul(unitCost)).div(totalAfter));
    }
  }

  await tx.stockBalance.update({ where: { id: bal.id }, data: { quantity: newLotQty } });
  if (!newAvg.equals(avg)) await tx.item.update({ where: { id: item.id }, data: { avgCost: newAvg } });

  if (item.serialTracked && serials.length) await moveSerials(tx, item.id, item.code, m, serials);

  const whOnHand = await onHand(tx, m.itemId, m.warehouseId);
  return tx.inventoryTransaction.create({
    data: {
      txnDate: m.txnDate ?? new Date(),
      type: m.type,
      itemId: m.itemId,
      warehouseId: m.warehouseId,
      locationId: m.locationId ?? null,
      batchId: m.batchId ?? null,
      serialNos: serials.length ? serials.join(",") : null,
      quantity: m.quantity,
      unitCost,
      totalValue: round2(m.quantity.mul(unitCost)),
      balanceAfter: whOnHand,
      refDocType: m.ref.docType,
      refDocId: m.ref.docId,
      refDocNo: m.ref.docNo,
      refLineId: m.ref.lineId ?? null,
      userId: ctx.userId,
      notes: m.notes ?? null,
    },
  });
}

async function moveSerials(tx: Tx, itemId: string, itemCode: string, m: StockMovement, serials: string[]) {
  if (m.quantity.gt(0)) {
    for (const s of serials) {
      const ex = await tx.serialNumber.findUnique({ where: { itemId_serialNo: { itemId, serialNo: s } } });
      if (ex && ex.status === "IN_STOCK" && m.type !== "TRANSFER_IN") {
        throw new AppError(`Serial ${s} of ${itemCode} is already in stock.`);
      }
      if (ex) {
        await tx.serialNumber.update({ where: { id: ex.id }, data: { status: "IN_STOCK", warehouseId: m.warehouseId, batchId: m.batchId ?? ex.batchId } });
      } else {
        await tx.serialNumber.create({ data: { itemId, serialNo: s, status: "IN_STOCK", warehouseId: m.warehouseId, batchId: m.batchId ?? null } });
      }
    }
  } else {
    for (const s of serials) {
      const ex = await tx.serialNumber.findUnique({ where: { itemId_serialNo: { itemId, serialNo: s } } });
      if (!ex || ex.status !== "IN_STOCK" || ex.warehouseId !== m.warehouseId) {
        throw new AppError(`Serial ${s} of ${itemCode} is not in stock in the selected warehouse.`);
      }
      // TRANSFER_OUT keeps IN_STOCK; the paired TRANSFER_IN reassigns the warehouse.
      if (m.type !== "TRANSFER_OUT") {
        await tx.serialNumber.update({ where: { id: ex.id }, data: { status: m.serialOutStatus ?? "SCRAPPED", warehouseId: null } });
      }
    }
  }
}

/**
 * Checks that an outbound quantity does not consume stock reserved for other
 * sales orders. `ownSoLineId` lets a delivery use its own reservation.
 */
export async function assertAvailable(
  tx: Tx, itemId: string, warehouseId: string, qty: Dec, opts: { ownSoLineId?: string; allowNegative?: boolean; itemCode?: string } = {},
) {
  if (opts.allowNegative) return;
  const oh = await onHand(tx, itemId, warehouseId);
  const otherReserved = await reservedQty(tx, itemId, warehouseId, opts.ownSoLineId);
  const free = oh.sub(otherReserved);
  if (free.lt(qty)) {
    throw new AppError(
      `Insufficient available stock for ${opts.itemCode ?? "item"}: on hand ${fmtQty(oh)}, reserved for other orders ${fmtQty(otherReserved)}, required ${fmtQty(qty)}.`,
    );
  }
}
