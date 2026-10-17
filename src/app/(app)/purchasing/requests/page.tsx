import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { listPurchaseRequests } from "@/server/services/purchasing";
import { PageHeader, LinkButton, StatusBadge, Badge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { listArgs, str, type SP } from "@/lib/params";
import { fmtDate, fmtMoney, humanize } from "@/lib/format";
import { opts } from "@/lib/options";

export const metadata = { title: "Purchase requests" };

export default async function PrPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("purchase.view");
  const sp = await searchParams;
  const data = await listPurchaseRequests(user, { ...listArgs(sp), status: str(sp, "status") });
  return (
    <>
      <PageHeader title="Purchase requests" subtitle="Request → Approval → RFQ → Supplier offers → Comparison → Purchase order" crumbs={[{ label: "Procurement" }, { label: "Purchase requests" }]}
        actions={user.permissions.has("purchase.request.manage") && <LinkButton href="/purchasing/requests/new" variant="action"><Plus className="h-4 w-4" /> New request</LinkButton>} />
      <ListToolbar placeholder="Search number, department, justification…" filters={[{ name: "status", label: "Status", options: opts(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "PARTIALLY_ORDERED", "ORDERED", "CANCELLED"]) }]} />
      <DataTable basePath="/purchasing/requests" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No purchase requests"
        columns={[{ label: "Number", sort: "number" }, { label: "Date", sort: "date" }, { label: "Department" }, { label: "Justification" }, { label: "Required", sort: "requiredDate" }, { label: "Estimate", sort: "estimatedTotal", align: "right" }, { label: "Source" }, { label: "Status", sort: "status" }]}
        rows={data.rows.map((r) => ({ key: r.id, cells: [
          <Link key="n" className="link" href={`/purchasing/requests/${r.id}`}>{r.number}</Link>, fmtDate(r.date), r.department, <span key="j" className="line-clamp-1 max-w-xs text-xs">{r.justification}</span>,
          fmtDate(r.requiredDate), fmtMoney(r.estimatedTotal), r.source === "MANUAL" ? "" : <Badge key="b" tone="blue">{humanize(r.source)}</Badge>, <StatusBadge key="s" status={r.status} />,
        ] }))} />
    </>
  );
}
