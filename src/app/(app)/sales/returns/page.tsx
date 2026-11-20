import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listCustomerReturns } from "@/server/services/returns";
import { PageHeader } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { listArgs, type SP } from "@/lib/params";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Customer returns" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("sales.view");
  const sp = await searchParams;
  const data = await listCustomerReturns(user, listArgs(sp));
  return (
    <>
      <PageHeader title="Customer returns" subtitle="Goods returned by customers against posted deliveries. Start a return from the delivery." crumbs={[{ label: "Sales" }, { label: "Customer returns" }]} />
      <ListToolbar placeholder="Search number, reason, customer…" />
      <DataTable basePath="/sales/returns" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No customer returns"
        columns={[{ label: "Return", sort: "number" }, { label: "Date", sort: "date" }, { label: "Customer" }, { label: "Delivery" }, { label: "Reason" }]}
        rows={data.rows.map((r) => ({ key: r.id, cells: [<Link key="n" className="link" href={`/sales/returns/${r.id}`}>{r.number}</Link>, fmtDate(r.date), r.customer.legalName, <Link key="d" className="link" href={`/sales/deliveries/${r.deliveryId}`}>{r.delivery.number}</Link>, r.reason] }))} />
    </>
  );
}
