import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, withTx } from "../db";
import { requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { AppError, NotFoundError } from "../errors";
import { nonNegDecimal, optId, optStr, reqStr } from "@/lib/validation";
import { D, ZERO } from "@/lib/decimal";
import { orderBy, paging, type ListArgs } from "./common";

export const ITEM_TYPES = ["PRODUCT", "CHEMICAL", "EQUIPMENT", "SPARE_PART", "CONSUMABLE", "SERVICE"] as const;
export const INVENTORY_CLASSES = ["STOCK", "SERIALIZED_ASSET", "RENTAL", "NON_STOCK"] as const;

export const itemSchema = z.object({
  code: reqStr(40).transform((s) => s.toUpperCase()),
  name: reqStr(200),
  description: optStr(2000),
  categoryId: optId,
  itemType: z.enum(ITEM_TYPES).default("PRODUCT"),
  inventoryClass: z.enum(INVENTORY_CLASSES).default("STOCK"),
  manufacturer: optStr(120),
  manufacturerPartNo: optStr(80),
  supplierPartNo: optStr(80),
  uomId: reqStr(40),
  preferredSupplierId: optId,
  minStockLevel: nonNegDecimal.default("0"),
  reorderQty: nonNegDecimal.default("0"),
  purchasePrice: nonNegDecimal.default("0"),
  sellingPrice: nonNegDecimal.default("0"),
  defaultWarehouseId: optId,
  defaultLocationId: optId,
  batchTracked: z.boolean().default(false),
  serialTracked: z.boolean().default(false),
  expiryTracked: z.boolean().default(false),
  hazardous: z.boolean().default(false),
  active: z.boolean().default(true),
}).transform((d) => {
  // Services / non-stock items never carry stock controls.
  if (d.itemType === "SERVICE") d.inventoryClass = "NON_STOCK";
  if (d.inventoryClass === "NON_STOCK") { d.batchTracked = false; d.serialTracked = false; d.expiryTracked = false; }
  if (d.inventoryClass === "SERIALIZED_ASSET" || d.inventoryClass === "RENTAL") d.serialTracked = true;
  if (d.expiryTracked) d.batchTracked = true;
  return d;
});

export async function createItem(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "item.manage");
  const data = itemSchema.parse(raw);
  return withTx(async (tx) => {
    const item = await tx.item.create({ data: { ...data, avgCost: data.purchasePrice } });
    await audit(tx, ctx, { action: "CREATE", entity: "Item", entityId: item.id, summary: `Created item ${item.code}`, after: item });
    return item;
  });
}

export async function updateItem(ctx: Ctx, id: string, raw: unknown) {
  requirePerm(ctx, "item.manage");
  const data = itemSchema.parse(raw);
  return withTx(async (tx) => {
    const before = await tx.item.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Item");
    const hasMovements = (await tx.inventoryTransaction.count({ where: { itemId: id } })) > 0;
    if (hasMovements) {
      // Tracking rules and UoM cannot change once stock history exists.
      const locked = ["uomId", "batchTracked", "serialTracked", "inventoryClass", "code"] as const;
      for (const f of locked) {
        if (before[f] !== data[f]) throw new AppError(`Cannot change ${f} after stock movements exist for this item.`);
      }
      if (data.itemType === "SERVICE" && before.itemType !== "SERVICE") throw new AppError("Cannot convert a stocked item into a service.");
    }
    const after = await tx.item.update({ where: { id }, data });
    await audit(tx, ctx, { action: "UPDATE", entity: "Item", entityId: id, summary: `Updated item ${after.code}`, before, after });
    return after;
  });
}

export async function listItems(ctx: Ctx, a: ListArgs & { categoryId?: string; itemType?: string; stock?: string; active?: string; warehouseId?: string }) {
  requirePerm(ctx, "item.view");
  const where: Prisma.ItemWhereInput = {
    ...(a.q ? { OR: [
      { code: { contains: a.q, mode: "insensitive" } }, { name: { contains: a.q, mode: "insensitive" } },
      { manufacturerPartNo: { contains: a.q, mode: "insensitive" } }, { manufacturer: { contains: a.q, mode: "insensitive" } },
    ] } : {}),
    ...(a.categoryId ? { categoryId: a.categoryId } : {}),
    ...(a.itemType ? { itemType: a.itemType as never } : {}),
    ...(a.active === "inactive" ? { active: false } : a.active === "all" ? {} : { active: true }),
  };
  const all = a.stock === "low" || a.stock === "out";
  const { skip, take, page, pageSize } = paging(a);
  const rows = await prisma.item.findMany({
    where, skip: all ? undefined : skip, take: all ? undefined : take,
    include: { category: true, uom: true },
    orderBy: orderBy(a, ["code", "name", "itemType", "sellingPrice"], { code: "asc" }),
  });
  const ids = rows.map((r) => r.id);
  const [bal, res] = await Promise.all([
    prisma.stockBalance.groupBy({ by: ["itemId"], where: { itemId: { in: ids }, ...(a.warehouseId ? { warehouseId: a.warehouseId } : {}) }, _sum: { quantity: true } }),
    prisma.stockReservation.groupBy({ by: ["itemId"], where: { itemId: { in: ids }, status: "ACTIVE", ...(a.warehouseId ? { warehouseId: a.warehouseId } : {}) }, _sum: { quantity: true } }),
  ]);
  const bm = new Map(bal.map((b) => [b.itemId, D(b._sum.quantity)]));
  const rm = new Map(res.map((b) => [b.itemId, D(b._sum.quantity)]));
  let enriched = rows.map((r) => {
    const onHand = bm.get(r.id) ?? ZERO;
    const reserved = rm.get(r.id) ?? ZERO;
    const stocked = r.inventoryClass !== "NON_STOCK";
    const hasMin = D(r.minStockLevel).gt(0);
    const status = !stocked ? "NON_STOCK" : onHand.lte(0) ? (hasMin ? "OUT" : "NONE") : hasMin && onHand.lte(r.minStockLevel) ? "LOW" : "OK";
    return { ...r, onHand, reserved, available: onHand.sub(reserved), stockStatus: status as "NON_STOCK" | "OUT" | "NONE" | "LOW" | "OK" };
  });
  let total: number;
  if (all) {
    enriched = enriched.filter((r) => r.stockStatus === (a.stock === "out" ? "OUT" : "LOW"));
    total = enriched.length;
    enriched = enriched.slice(skip, skip + take);
  } else {
    total = await prisma.item.count({ where });
  }
  return { rows: enriched, total, page, pageSize };
}

export async function getItem(ctx: Ctx, id: string) {
  requirePerm(ctx, "item.view");
  const item = await prisma.item.findUnique({
    where: { id },
    include: { category: true, uom: true, preferredSupplier: true, defaultWarehouse: true, defaultLocation: true },
  });
  if (!item) throw new NotFoundError("Item");
  return item;
}

// ── Categories, UoM, warehouses, locations ──

const catSchema = z.object({ code: reqStr(30).transform((s) => s.toUpperCase()), name: reqStr(120), parentId: optId, active: z.boolean().default(true) });
const uomSchema = z.object({ code: reqStr(20).transform((s) => s.toUpperCase()), name: reqStr(80), active: z.boolean().default(true) });
const whSchema = z.object({ code: reqStr(20).transform((s) => s.toUpperCase()), name: reqStr(120), address: optStr(300), active: z.boolean().default(true) });
const locSchema = z.object({ code: reqStr(30).transform((s) => s.toUpperCase()), name: optStr(120), active: z.boolean().default(true) });

type MasterKind = "category" | "uom" | "warehouse";

export async function saveMaster(ctx: Ctx, kind: MasterKind, id: string | null, raw: unknown) {
  requirePerm(ctx, "item.manage");
  return withTx(async (tx) => {
    let rec: { id: string; code: string };
    if (kind === "category") {
      const d = catSchema.parse(raw);
      if (id && d.parentId === id) throw new AppError("A category cannot be its own parent.");
      rec = id ? await tx.itemCategory.update({ where: { id }, data: d }) : await tx.itemCategory.create({ data: d });
    } else if (kind === "uom") {
      const d = uomSchema.parse(raw);
      rec = id ? await tx.unitOfMeasure.update({ where: { id }, data: d }) : await tx.unitOfMeasure.create({ data: d });
    } else {
      const d = whSchema.parse(raw);
      rec = id ? await tx.warehouse.update({ where: { id }, data: d }) : await tx.warehouse.create({ data: d });
    }
    await audit(tx, ctx, { action: id ? "UPDATE" : "CREATE", entity: kind, entityId: rec.id, summary: `${id ? "Updated" : "Created"} ${kind} ${rec.code}`, after: rec });
    return rec;
  });
}

export async function saveLocation(ctx: Ctx, warehouseId: string, id: string | null, raw: unknown) {
  requirePerm(ctx, "item.manage");
  const d = locSchema.parse(raw);
  return withTx(async (tx) => {
    const rec = id
      ? await tx.warehouseLocation.update({ where: { id }, data: d })
      : await tx.warehouseLocation.create({ data: { ...d, warehouseId } });
    await audit(tx, ctx, { action: id ? "UPDATE" : "CREATE", entity: "WarehouseLocation", entityId: rec.id, summary: `Location ${rec.code}`, after: rec });
    return rec;
  });
}
