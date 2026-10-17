import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { QuickFormButton } from "@/components/forms/small-forms";
import { createCountAction } from "@/app/actions/inventory";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Stock counts" };

export default async function CountsPage() {
  const user = await requireUser("inventory.count", "inventory.adjust.approve");
  const [counts, whs, cats] = await Promise.all([
    prisma.stockCount.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { _count: { select: { lines: true } } } }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.itemCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const wh = new Map(whs.map((w) => [w.id, w.code]));
  return (
    <>
      <PageHeader title="Physical stock counts" subtitle="Count sheets are generated from current balances. Variances post as count gains/losses after approval." crumbs={[{ label: "Store & inventory" }, { label: "Stock counts" }]}
        actions={user.permissions.has("inventory.count") && <QuickFormButton variant="action" label="Start count" title="Start physical count" action={createCountAction} fields={[
          { name: "warehouseId", label: "Warehouse", type: "select", required: true, options: whs.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })) },
          { name: "categoryId", label: "Category (optional)", type: "select", options: cats.map((c) => ({ value: c.id, label: c.name })) },
          { name: "notes", label: "Notes", type: "textarea" },
        ]} />} />
      <DataTable basePath="/inventory/counts" empty="No counts yet" columns={[{ label: "Number" }, { label: "Date" }, { label: "Warehouse" }, { label: "Lines", align: "right" }, { label: "Status" }]}
        rows={counts.map((c) => ({ key: c.id, cells: [<Link key="n" className="link" href={`/inventory/counts/${c.id}`}>{c.number}</Link>, fmtDate(c.date), wh.get(c.warehouseId), c._count.lines, <StatusBadge key="s" status={c.status} />] }))} />
    </>
  );
}
