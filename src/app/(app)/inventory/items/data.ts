import { prisma } from "@/server/db";

export async function itemFormOptions() {
  const [cats, uoms, whs, locs] = await Promise.all([
    prisma.itemCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.unitOfMeasure.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.warehouseLocation.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
  ]);
  return {
    categories: cats.map((c) => ({ value: c.id, label: c.name })),
    uoms: uoms.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` })),
    warehouses: whs.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })),
    locations: locs.map((l) => ({ value: l.id, label: l.code, warehouseId: l.warehouseId })),
  };
}
