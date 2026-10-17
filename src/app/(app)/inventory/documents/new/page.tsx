import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { StockDocForm } from "./form";

export const metadata = { title: "New stock document" };

export default async function Page({ searchParams }: { searchParams: Promise<{ type?: string; itemId?: string }> }) {
  const user = await requireUser("inventory.adjust", "inventory.transfer", "inventory.issue");
  const { type, itemId } = await searchParams;
  const whs = await prisma.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  const item = itemId ? await prisma.item.findUnique({ where: { id: itemId } }) : null;
  const allowed = [
    user.permissions.has("inventory.adjust") && "ADJUSTMENT", user.permissions.has("inventory.adjust") && "OPENING",
    user.permissions.has("inventory.transfer") && "TRANSFER", user.permissions.has("inventory.issue") && "ISSUE",
  ].filter(Boolean) as string[];
  return (
    <>
      <PageHeader title="New stock document" crumbs={[{ label: "Stock documents", href: "/inventory/documents" }, { label: "New" }]} />
      <StockDocForm allowed={allowed} initialType={type && allowed.includes(type) ? type : allowed[0]} warehouses={whs.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))}
        initialItem={item ? { id: item.id, label: `${item.code} — ${item.name}`, batch: item.batchTracked, serial: item.serialTracked, expiry: item.expiryTracked, cost: item.avgCost.toString() } : null} />
    </>
  );
}
