import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { listPurchaseOrders } from "@/server/services/purchasing";
import { PageHeader, LinkButton, StatusBadge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { dateRange, listArgs, str, type SP } from "@/lib/params";
import { fmtDate, fmtMoney } from "@/lib/format";
import { opts } from "@/lib/options";

export const metadata = { title: "Purchase orders" };

export default async function PoListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("purchase.view");
  const sp = await searchParams;
  const status = str(sp, "status");
  const data = await listPurchaseOrders(user, { ...listArgs(sp), status: status === "OVERDUE" ? undefined : status, overdue: status === "OVERDUE", supplierId: str(sp, "supplierId"), ...dateRange(sp) });
  const now = new Date();
  return (
    <>
      <PageHeader title="Purchase orders" crumbs={[{ label: "Procurement" }, { label: "Purchase orders" }]}
        actions={user.permissions.has("purchase.order.manage") && <LinkButton href="/purchasing/orders/new" variant="action"><Plus className="h-4 w-4" /> New purchase order</LinkButton>} />
      <ListToolbar dateRange placeholder="Search PO, supplier quote ref or supplier…" filters={[{ name: "status", label: "Status", options: [{ value: "OPEN", label: "Open" }, { value: "OVERDUE", label: "Overdue delivery" }, ...opts(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"])] }]} />
      <DataTable basePath="/purchasing/orders" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No purchase orders"
        columns={[{ label: "PO", sort: "number" }, { label: "Date", sort: "date" }, { label: "Supplier" }, { label: "Expected", sort: "expectedDate" }, { label: "Total", sort: "total", align: "right" }, { label: "Status", sort: "status" }]}
        rows={data.rows.map((o) => {
          const late = o.expectedDate && o.expectedDate < now && ["APPROVED", "PARTIALLY_RECEIVED"].includes(o.status);
          return { key: o.id, cells: [<Link key="n" className="link" href={`/purchasing/orders/${o.id}`}>{o.number}</Link>, fmtDate(o.date), o.supplier.legalName,
            <span key="e" className={late ? "font-semibold text-red-600" : ""}>{fmtDate(o.expectedDate)}{late && " (late)"}</span>, fmtMoney(o.total, o.currency), <StatusBadge key="s" status={o.status} />] };
        })} />
    </>
  );
}
