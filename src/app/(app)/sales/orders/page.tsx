import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { listSalesOrders } from "@/server/services/sales";
import { PageHeader, LinkButton, StatusBadge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { dateRange, listArgs, str, type SP } from "@/lib/params";
import { fmtDate, fmtMoney } from "@/lib/format";
import { opts } from "@/lib/options";

export const metadata = { title: "Sales orders" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("sales.view");
  const sp = await searchParams;
  const data = await listSalesOrders(user, { ...listArgs(sp), status: str(sp, "status"), customerId: str(sp, "customerId"), ...dateRange(sp) });
  return (
    <>
      <PageHeader title="Sales orders" crumbs={[{ label: "Sales" }, { label: "Sales orders" }]}
        actions={user.permissions.has("sales.order.manage") && <LinkButton href="/sales/orders/new" variant="action"><Plus className="h-4 w-4" /> New sales order</LinkButton>} />
      <ListToolbar dateRange placeholder="Search number, customer PO or customer…" filters={[{ name: "status", label: "Status", options: [{ value: "OPEN", label: "Open (awaiting processing)" }, ...opts(["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED", "CANCELLED"])] }]} />
      <DataTable basePath="/sales/orders" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No sales orders"
        columns={[{ label: "Number", sort: "number" }, { label: "Date", sort: "date" }, { label: "Customer" }, { label: "Customer PO" }, { label: "Required", sort: "requiredDate" }, { label: "Total", sort: "total", align: "right" }, { label: "Status", sort: "status" }]}
        rows={data.rows.map((o) => ({ key: o.id, cells: [
          <Link key="n" className="link" href={`/sales/orders/${o.id}`}>{o.number}</Link>, fmtDate(o.date), o.customer.legalName, o.customerPoRef,
          <span key="r" className={o.requiredDate && o.requiredDate < new Date() && ["APPROVED", "PARTIALLY_DELIVERED"].includes(o.status) ? "font-semibold text-red-600" : ""}>{fmtDate(o.requiredDate)}</span>,
          fmtMoney(o.total, o.currency), <StatusBadge key="s" status={o.status} />,
        ] }))} />
    </>
  );
}
