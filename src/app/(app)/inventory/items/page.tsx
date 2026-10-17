import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { listItems } from "@/server/services/items";
import { PageHeader, LinkButton, StatusBadge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { listArgs, str, type SP } from "@/lib/params";
import { fmtQty, fmtAmount, humanize } from "@/lib/format";
import { ITEM_TYPES, opts } from "@/lib/options";

export const metadata = { title: "Items" };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("item.view");
  const sp = await searchParams;
  const [data, cats, whs] = await Promise.all([
    listItems(user, { ...listArgs(sp), categoryId: str(sp, "categoryId"), itemType: str(sp, "itemType"), stock: str(sp, "stock"), active: str(sp, "active"), warehouseId: str(sp, "warehouseId") }),
    prisma.itemCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Item master" subtitle={`${data.total} item(s)`} crumbs={[{ label: "Store & inventory" }, { label: "Items" }]}
        actions={user.permissions.has("item.manage") && <LinkButton href="/inventory/items/new" variant="action"><Plus className="h-4 w-4" /> New item</LinkButton>} />
      <ListToolbar placeholder="Search code, description, manufacturer, part no…" filters={[
        { name: "categoryId", label: "Category", options: cats.map((c) => ({ value: c.id, label: c.name })) },
        { name: "itemType", label: "Type", options: opts(ITEM_TYPES) },
        { name: "warehouseId", label: "Warehouse", options: whs.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })) },
        { name: "stock", label: "Stock level", options: [{ value: "low", label: "Low stock" }, { value: "out", label: "Out of stock" }] },
        { name: "active", label: "Status", options: [{ value: "inactive", label: "Inactive" }, { value: "all", label: "All" }] },
      ]} />
      <DataTable basePath="/inventory/items" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No items found"
        columns={[{ label: "Code", sort: "code" }, { label: "Description", sort: "name" }, { label: "Category" }, { label: "Type", sort: "itemType" }, { label: "UoM" }, { label: "On hand", align: "right" }, { label: "Reserved", align: "right" }, { label: "Available", align: "right" }, { label: "Min", align: "right" }, { label: "Selling price", sort: "sellingPrice", align: "right" }, { label: "Stock" }]}
        rows={data.rows.map((i) => ({ key: i.id, cells: [
          <Link key="c" href={`/inventory/items/${i.id}`} className="link whitespace-nowrap font-mono text-xs">{i.code}</Link>,
          <div key="n"><Link href={`/inventory/items/${i.id}`} className="font-medium hover:text-brand-600">{i.name}</Link>{i.manufacturer && <div className="text-xs text-ink-muted">{i.manufacturer}{i.manufacturerPartNo && ` · ${i.manufacturerPartNo}`}</div>}</div>,
          i.category?.name, humanize(i.itemType), i.uom.code,
          i.stockStatus === "NON_STOCK" ? "—" : fmtQty(i.onHand), i.stockStatus === "NON_STOCK" ? "—" : fmtQty(i.reserved),
          i.stockStatus === "NON_STOCK" ? "—" : <b key="a">{fmtQty(i.available)}</b>, fmtQty(i.minStockLevel), fmtAmount(i.sellingPrice),
          <StatusBadge key="s" status={i.active ? i.stockStatus : "INACTIVE"} label={i.stockStatus === "NON_STOCK" ? "Service" : i.stockStatus === "NONE" ? "No stock" : undefined} />,
        ] }))} />
    </>
  );
}
