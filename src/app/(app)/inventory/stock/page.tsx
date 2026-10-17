import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { stockOnHandReport } from "@/server/services/inventory";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { str, type SP } from "@/lib/params";
import { fmtMoney, fmtQty } from "@/lib/format";

export const metadata = { title: "Stock on hand" };

export default async function StockPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("inventory.view");
  const sp = await searchParams;
  const [rows, whs, cats] = await Promise.all([
    stockOnHandReport(user, { warehouseId: str(sp, "warehouseId"), categoryId: str(sp, "categoryId"), q: str(sp, "q") }),
    prisma.warehouse.findMany({ orderBy: { code: "asc" } }),
    prisma.itemCategory.findMany({ orderBy: { name: "asc" } }),
  ]);
  const total = rows.reduce((s, r) => s + Number(r.value), 0);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Stock on hand" subtitle={<>Valued at weighted-average cost · total <b>{fmtMoney(total)}</b></>} crumbs={[{ label: "Store & inventory" }, { label: "Stock on hand" }]}
        actions={user.permissions.has("reports.export") && <LinkButton variant="outline" href={`/api/reports/stock-valuation/export?format=xlsx&${qs}`}><Download className="h-4 w-4" /> Excel</LinkButton>} />
      <ListToolbar placeholder="Search item code or description…" filters={[
        { name: "warehouseId", label: "Warehouse", options: whs.map((w) => ({ value: w.id, label: w.code })) },
        { name: "categoryId", label: "Category", options: cats.map((c) => ({ value: c.id, label: c.name })) },
      ]} />
      <DataTable basePath="/inventory/stock" sp={sp} empty="No stock on hand"
        columns={[{ label: "Item" }, { label: "Description" }, { label: "Category" }, { label: "Warehouse" }, { label: "On hand", align: "right" }, { label: "Reserved", align: "right" }, { label: "Available", align: "right" }, { label: "Avg cost", align: "right" }, { label: "Value", align: "right" }]}
        rows={rows.map((r) => ({ key: `${r.item.id}-${r.warehouse.id}`, cells: [
          <Link key="i" className="link whitespace-nowrap font-mono text-xs" href={`/inventory/items/${r.item.id}`}>{r.item.code}</Link>, r.item.name, r.item.category?.name, r.warehouse.code,
          `${fmtQty(r.onHand)} ${r.item.uom.code}`, fmtQty(r.reserved), <b key="a">{fmtQty(r.available)}</b>, fmtMoney(r.avgCost, ""), fmtMoney(r.value, ""),
        ] }))}
        footer={rows.length ? <tfoot><tr><td colSpan={8} className="text-right font-bold">Total value (QAR)</td><td className="num font-bold">{fmtMoney(total, "")}</td></tr></tfoot> : undefined} />
    </>
  );
}
