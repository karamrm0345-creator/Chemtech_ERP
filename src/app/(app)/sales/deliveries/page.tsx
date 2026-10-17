import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listDeliveries } from "@/server/services/sales";
import { PageHeader, StatusBadge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { listArgs, str, type SP } from "@/lib/params";
import { fmtDate } from "@/lib/format";
import { opts } from "@/lib/options";

export const metadata = { title: "Delivery orders" };

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("sales.view");
  const sp = await searchParams;
  const data = await listDeliveries(user, { ...listArgs(sp), status: str(sp, "status") });
  return (
    <>
      <PageHeader title="Delivery orders" subtitle="Create deliveries from an approved sales order. Posting a delivery issues stock exactly once." crumbs={[{ label: "Sales" }, { label: "Deliveries" }]} />
      <ListToolbar placeholder="Search delivery, order or customer…" filters={[{ name: "status", label: "Status", options: opts(["DRAFT", "POSTED", "CANCELLED"]) }]} />
      <DataTable basePath="/sales/deliveries" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No deliveries"
        columns={[{ label: "Number", sort: "number" }, { label: "Date", sort: "date" }, { label: "Sales order" }, { label: "Customer" }, { label: "Status", sort: "status" }]}
        rows={data.rows.map((d) => ({ key: d.id, cells: [<Link key="n" className="link" href={`/sales/deliveries/${d.id}`}>{d.number}</Link>, fmtDate(d.date), <Link key="o" className="link" href={`/sales/orders/${d.salesOrderId}`}>{d.salesOrder.number}</Link>, d.customer.legalName, <StatusBadge key="s" status={d.status} />] }))} />
    </>
  );
}
