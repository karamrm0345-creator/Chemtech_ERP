import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { listQuotations } from "@/server/services/sales";
import { PageHeader, LinkButton, StatusBadge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { dateRange, listArgs, str, type SP } from "@/lib/params";
import { fmtDate, fmtMoney } from "@/lib/format";
import { opts } from "@/lib/options";

export const metadata = { title: "Sales quotations" };

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("sales.view");
  const sp = await searchParams;
  const data = await listQuotations(user, { ...listArgs(sp), status: str(sp, "status"), ...dateRange(sp) });
  return (
    <>
      <PageHeader title="Sales quotations" subtitle="Draft → Submitted → Approved → Sent → Accepted / Rejected → Converted" crumbs={[{ label: "Sales" }, { label: "Quotations" }]}
        actions={user.permissions.has("sales.quotation.manage") && <LinkButton href="/sales/quotations/new" variant="action"><Plus className="h-4 w-4" /> New quotation</LinkButton>} />
      <ListToolbar dateRange placeholder="Search number, reference or customer…" filters={[{ name: "status", label: "Status", options: opts(["DRAFT", "SUBMITTED", "APPROVED", "SENT", "ACCEPTED", "REJECTED", "CONVERTED", "CANCELLED", "REVISED"]) }]} />
      <DataTable basePath="/sales/quotations" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No quotations"
        columns={[{ label: "Number", sort: "number" }, { label: "Date", sort: "date" }, { label: "Customer" }, { label: "Reference" }, { label: "Valid until", sort: "validUntil" }, { label: "Total", sort: "total", align: "right" }, { label: "Status", sort: "status" }]}
        rows={data.rows.map((q) => ({ key: q.id, cells: [
          <Link key="n" className="link" href={`/sales/quotations/${q.id}`}>{q.number}</Link>, fmtDate(q.date), q.customer.legalName, q.reference,
          <span key="v" className={q.validUntil && q.validUntil < new Date() && ["APPROVED", "SENT"].includes(q.status) ? "font-semibold text-red-600" : ""}>{fmtDate(q.validUntil)}</span>,
          fmtMoney(q.total, q.currency), <StatusBadge key="s" status={q.status} />,
        ] }))} />
    </>
  );
}
