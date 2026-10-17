import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { createCustomer } from "@/server/services/customers";
import { createSupplier } from "@/server/services/suppliers";
import { createItem } from "@/server/services/items";
import { createStockDocument, postStockDocument } from "@/server/services/inventory";

let seq = 0;
export const uid = (p = "T") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`.toUpperCase();

/** Creates a real user with the given role and returns their service context. */
export async function ctxFor(roleCode: string): Promise<Ctx> {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode }, include: { permissions: true } });
  const u = await prisma.user.create({ data: { name: `${roleCode} ${uid()}`, email: `${uid("u").toLowerCase()}@test.local`, passwordHash: "x", roleId: role.id } });
  return { userId: u.id, userName: u.name, roleId: role.id, roleCode, permissions: new Set(role.permissions.map((p) => p.permission)) };
}

/** A context holding every permission (for fixture setup only). */
export async function superCtx(): Promise<Ctx> {
  const c = await ctxFor("SYSTEM_ADMIN");
  const { ALL_PERMISSIONS } = await import("@/server/auth/permissions");
  return { ...c, permissions: new Set(ALL_PERMISSIONS) };
}

export async function makeWarehouse(code = uid("WH")) {
  return prisma.warehouse.create({ data: { code, name: `Warehouse ${code}` } });
}

export async function makeCustomer(ctx: Ctx, name = `Customer ${uid()}`) {
  const r = await createCustomer(ctx, { legalName: name }, { ignoreDuplicates: true });
  return r.customer!;
}

export async function makeSupplier(ctx: Ctx, name = `Supplier ${uid()}`) {
  const r = await createSupplier(ctx, { legalName: name, prequalStatus: "APPROVED" }, { ignoreDuplicates: true });
  return r.supplier!;
}

export async function makeItem(ctx: Ctx, extra: Record<string, unknown> = {}) {
  const uom = await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: "EA" } });
  return createItem(ctx, { code: uid("IT"), name: `Item ${uid()}`, uomId: uom.id, purchasePrice: "10", sellingPrice: "15", ...extra });
}

/** Posts an opening balance through the authorized document workflow (preparer ≠ approver). */
export async function openingBalance(itemId: string, warehouseId: string, qty: string, unitCost = "10", extra: Record<string, unknown> = {}) {
  const preparer = await ctxFor("STOREKEEPER");
  const approver = await ctxFor("STORE_MANAGER");
  const doc = await createStockDocument(preparer, { type: "OPENING", warehouseId, lines: [{ itemId, quantity: qty, unitCost, ...extra }] });
  await postStockDocument(approver, doc.id);
  return doc;
}

export async function stock(itemId: string, warehouseId?: string) {
  const r = await prisma.stockBalance.aggregate({ where: { itemId, ...(warehouseId ? { warehouseId } : {}) }, _sum: { quantity: true } });
  return Number(r._sum.quantity ?? 0);
}

export async function ledgerCount(where: Record<string, unknown>) {
  return prisma.inventoryTransaction.count({ where });
}
