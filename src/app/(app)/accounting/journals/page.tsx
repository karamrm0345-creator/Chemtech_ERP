import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listJournals } from "@/server/services/accounting";
import { PageHeader, StatusBadge, LinkButton } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { dateRange, listArgs, str, type SP } from "@/lib/params";
import { fmtAmount, fmtDate, humanize } from "@/lib/format";
import { JOURNAL_TYPES, sourceHref } from "@/lib/accounting-links";

export const metadata = { title: "Journal entries" };

export default async function JournalsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("accounting.view");
  const sp = await searchParams;
  const data = await listJournals(user, { ...listArgs(sp), ...dateRange(sp), type: str(sp, "type"), status: str(sp, "status") });
  return (
    <>
      <PageHeader title="Journal entries" subtitle="Every posting to the general ledger. Documents post their own journals; manual journals need a second person to post."
        crumbs={[{ label: "Accounting" }, { label: "Journal entries" }]}
        actions={user.permissions.has("accounting.journal.manage") && <LinkButton variant="action" href="/accounting/journals/new">New journal</LinkButton>} />
      <ListToolbar placeholder="Search number, memo, document…" dateRange filters={[
        { name: "type", label: "Type", options: JOURNAL_TYPES.map((t) => ({ value: t, label: humanize(t) })) },
        { name: "status", label: "Status", options: ["DRAFT", "POSTED", "CANCELLED"].map((t) => ({ value: t, label: humanize(t) })) },
      ]} />
      <DataTable basePath="/accounting/journals" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No journals"
        columns={[{ label: "Journal", sort: "number" }, { label: "Date", sort: "date" }, { label: "Type", sort: "type" }, { label: "Memo" }, { label: "Document" }, { label: "Amount", sort: "totalDebit", align: "right" }, { label: "Status", sort: "status" }]}
        rows={data.rows.map((j) => {
          const href = sourceHref(j.sourceType, j.sourceId);
          return { key: j.id, cells: [
            <Link key="n" className="link" href={`/accounting/journals/${j.id}`}>{j.number}</Link>, fmtDate(j.date), humanize(j.type),
            <span key="m" className="line-clamp-1">{j.memo}</span>, href ? <Link key="s" className="link" href={href}>{j.sourceNo}</Link> : j.sourceNo,
            fmtAmount(j.totalDebit), <StatusBadge key="st" status={j.reversalOfId ? "REVERSAL" : j.status} label={j.reversalOfId ? "Reversal" : undefined} />,
          ] };
        })} />
    </>
  );
}
