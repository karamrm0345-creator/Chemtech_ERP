import { prisma } from "@/server/db";
import { toDateInput } from "@/lib/format";
import type { LineState } from "@/components/forms/line-items";

export async function salesFormOptions() {
  const [cur, whs, s] = await Promise.all([
    prisma.currency.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } }),
  ]);
  return { currencies: cur.map((c) => c.code), warehouses: whs.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })), defaultTax: s.defaultTaxRate.toString() };
}

type DbLine = { id: string; itemId: string | null; description: string; quantity: { toString(): string }; uom: string | null; unitPrice: { toString(): string }; discountPct: { toString(): string }; taxRate: { toString(): string } };

export async function toLineStates(lines: DbLine[]): Promise<LineState[]> {
  const items = new Map((await prisma.item.findMany({ where: { id: { in: lines.map((l) => l.itemId!).filter(Boolean) } } })).map((i) => [i.id, `${i.code} — ${i.name}`]));
  return lines.map((l) => ({
    key: l.id, itemId: l.itemId, itemLabel: l.itemId ? items.get(l.itemId) : undefined, description: l.description, quantity: l.quantity.toString(),
    uom: l.uom ?? "", unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), taxRate: l.taxRate.toString(),
  }));
}

export { toDateInput };
