import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getJournal } from "@/server/services/accounting";
import { PageHeader, StatusBadge, Card, KeyValues, Notice, LinkButton } from "@/components/ui/primitives";
import { HistoryPanel } from "@/components/panels";
import { ActionButton } from "@/components/forms/action-button";
import { PrintButton } from "@/components/print-button";
import { postJournalAction, cancelJournalAction, reverseJournalAction } from "@/app/actions/accounting";
import { fmtAmount, fmtDate, fmtDateTime, humanize } from "@/lib/format";
import { sourceHref } from "@/lib/accounting-links";
import { D } from "@/lib/decimal";

export default async function JournalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("accounting.view");
  const { id } = await params;
  const j = await getJournal(user, id);
  if (!j) notFound();
  const manual = !j.sourceType;
  const canPost = user.permissions.has("accounting.journal.post");
  const canManage = user.permissions.has("accounting.journal.manage");
  const own = j.createdById === user.userId;
  const src = sourceHref(j.sourceType, j.sourceId);
  const dr = j.lines.reduce((s, l) => s.add(D(l.debit)), D(0)), cr = j.lines.reduce((s, l) => s.add(D(l.credit)), D(0));
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{j.number} <StatusBadge status={j.status} /></span>} subtitle={j.memo}
        crumbs={[{ label: "Accounting" }, { label: "Journal entries", href: "/accounting/journals" }, { label: j.number }]}
        actions={<>
          {j.status === "DRAFT" && canManage && <LinkButton variant="outline" href={`/accounting/journals/${id}/edit`}>Edit</LinkButton>}
          {j.status === "DRAFT" && canPost && !own && <ActionButton variant="action" label="Post journal" confirm="Post this journal to the general ledger? Posted journals cannot be edited, only reversed." action={postJournalAction.bind(null, id)} />}
          {j.status === "DRAFT" && canManage && <ActionButton variant="danger" label="Cancel draft" confirm="Cancel this draft journal?" action={cancelJournalAction.bind(null, id)} />}
          {j.status === "POSTED" && manual && !j.reversedBy && !j.reversalOfId && canPost && <ActionButton variant="danger" label="Reverse" prompt="Reason for reversing" promptRequired redirectBase="/accounting/journals" action={reverseJournalAction.bind(null, id)} />}
          <PrintButton />
        </>} />
      {j.status === "DRAFT" && own && canPost && <div className="mb-4"><Notice>You prepared this journal, so another user with posting rights must post it (separation of duties).</Notice></div>}
      {j.reversedBy && <div className="mb-4"><Notice tone="warning">Reversed by <Link className="link" href={`/accounting/journals/${j.reversedBy.id}`}>{j.reversedBy.number}</Link>.</Notice></div>}
      {j.reversalOf && <div className="mb-4"><Notice>This journal reverses <Link className="link" href={`/accounting/journals/${j.reversalOf.id}`}>{j.reversalOf.number}</Link>.</Notice></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card><KeyValues items={[
            ["Date", fmtDate(j.date)], ["Type", humanize(j.type)], ["Reference", j.reference ?? "—"],
            ["Document", src ? <Link key="s" className="link" href={src}>{j.sourceNo}</Link> : j.sourceNo ?? "—"],
            ["Prepared by", j.createdBy ?? "—"], ["Posted by", j.postedBy ? `${j.postedBy} · ${fmtDateTime(j.postedAt)}` : "—"],
          ]} /></Card>
          <Card bodyClass="p-0">
            <table className="table-base">
              <thead><tr><th>#</th><th>Account</th><th>Party</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
              <tbody>{j.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.lineNo}</td>
                  <td><Link className="link" href={`/accounting/ledger?account=${l.accountId}`}><span className="font-mono text-xs">{l.account.code}</span> {l.account.name}</Link></td>
                  <td>{l.partyId ? j.parties.get(l.partyId) ?? "—" : ""}</td>
                  <td>{l.description}</td>
                  <td className="num">{D(l.debit).isZero() ? "" : fmtAmount(l.debit)}</td>
                  <td className="num">{D(l.credit).isZero() ? "" : fmtAmount(l.credit)}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="font-semibold"><td colSpan={4} className="text-right">Total</td><td className="num">{fmtAmount(dr)}</td><td className="num">{fmtAmount(cr)}</td></tr></tfoot>
            </table>
          </Card>
        </div>
        <div className="no-print space-y-4"><HistoryPanel entity="JournalEntry" entityId={id} /></div>
      </div>
    </>
  );
}
