import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { listSuppliers } from "@/server/services/suppliers";
import { PageHeader, LinkButton, StatusBadge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { listArgs, str, type SP } from "@/lib/params";
import { humanize } from "@/lib/format";
import { SUPPLIER_CATEGORIES, PREQUAL, opts } from "@/lib/options";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("supplier.view");
  const sp = await searchParams;
  const data = await listSuppliers(user, { ...listArgs(sp), category: str(sp, "category"), prequal: str(sp, "prequal"), active: str(sp, "active") });
  return (
    <>
      <PageHeader title="Suppliers" subtitle={`${data.total} supplier record(s)`} crumbs={[{ label: "Procurement" }, { label: "Suppliers" }]}
        actions={user.permissions.has("supplier.manage") && <LinkButton href="/suppliers/new" variant="action"><Plus className="h-4 w-4" /> New supplier</LinkButton>} />
      <ListToolbar placeholder="Search name, code, products…" filters={[
        { name: "category", label: "Category", options: opts(SUPPLIER_CATEGORIES) },
        { name: "prequal", label: "Prequalification", options: opts(PREQUAL) },
        { name: "active", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
      ]} />
      <DataTable basePath="/suppliers" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No suppliers yet"
        columns={[{ label: "Code", sort: "code" }, { label: "Supplier", sort: "legalName" }, { label: "Category", sort: "category" }, { label: "Country" }, { label: "Products / services" }, { label: "Prequal.", sort: "prequalStatus" }, { label: "Rating", sort: "rating", align: "right" }, { label: "Status" }]}
        rows={data.rows.map((s) => ({ key: s.id, cells: [
          <Link key="c" href={`/suppliers/${s.id}`} className="link">{s.code}</Link>,
          <Link key="n" href={`/suppliers/${s.id}`} className="font-medium hover:text-brand-600">{s.legalName}</Link>,
          humanize(s.category), s.country, <span key="p" className="line-clamp-2 max-w-xs text-xs text-ink-soft">{s.productsServices}</span>,
          <StatusBadge key="q" status={s.prequalStatus} />, s.rating ? `${s.rating} / 5` : "—", <StatusBadge key="s" status={s.active ? "ACTIVE" : "INACTIVE"} />,
        ] }))} />
    </>
  );
}
