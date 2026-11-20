import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { matchCandidates, reconciliation } from "@/server/services/bank";
import { PageHeader, StatusBadge, Card, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ActionButton } from "@/components/forms/action-button";
import { QuickFormButton } from "@/components/forms/small-forms";
import { PrintButton } from "@/components/print-button";
import { autoMatchAction, bookStatementLineAction, completeReconciliationAction, deleteStatementAction, matchLineAction, unmatchLineAction } from "@/app/actions/accounting";
import { fmtAmount, fmtDate } from "@/lib/format";
import { D } from "@/lib/decimal";
import { cn } from "@/lib/cn";

export const metadata = { title: "Bank reconciliation" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("accounting.view");
  const { id } = await params;
  const r = await reconciliation(user, id);
  if (!r) notFound();
  const st = r.statement;
  const open = st.status === "OPEN" && user.permissions.has("accounting.bank.reconcile");
  const unmatched = st.lines.filter((l) => !l.journalLineId);
  const candidates = open ? new Map(await Promise.all(unmatched.map(async (l) => [l.id, await matchCandidates(l.id)] as const))) : new Map();
  const accounts = open ? await prisma.account.findMany({ where: { isGroup: false, active: true, NOT: { id: st.accountId } }, orderBy: { code: "asc" } }) : [];
  const charges = open ? await prisma.accountDefault.findUnique({ where: { key: "BANK_CHARGES" } }) : null;
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">Statement {st.reference} <StatusBadge status={st.status} /></span>} subtitle={`${st.account.code} ${st.account.name} · ${fmtDate(st.statementDate)}`}
        crumbs={[{ label: "Accounting" }, { label: "Bank reconciliation", href: "/accounting/bank" }, { label: st.reference }]}
        actions={<>
          {open && unmatched.length > 0 && <ActionButton variant="outline" label="Auto-match" action={autoMatchAction.bind(null, id)} />}
          {open && <ActionButton variant="danger" label="Delete statement" confirm="Delete this statement? Bank items booked from it are reversed; use this when it was imported into the wrong account or twice." redirectTo="/accounting/bank" action={deleteStatementAction.bind(null, id)} />}
          {open && <ActionButton variant="action" label="Complete reconciliation" confirm="Lock this statement as reconciled?" action={completeReconciliationAction.bind(null, id)} />}
          <PrintButton />
        </>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Reconciliation" className="xl:col-span-1">
          <table className="w-full text-sm">
            <tbody className="[&_td]:py-1.5">
              <tr><td>Balance per books at {fmtDate(st.statementDate)}</td><td className="num">{fmtAmount(r.bookBalance)}</td></tr>
              <tr><td>Less book entries not yet on the bank ({r.outstanding.length})</td><td className="num">{fmtAmount(r.uncleared.neg())}</td></tr>
              <tr><td>Add bank items not yet in the books ({unmatched.length})</td><td className="num">{fmtAmount(r.notBooked)}</td></tr>
              <tr className="border-t border-line font-semibold"><td>Adjusted balance</td><td className="num">{fmtAmount(r.adjusted)}</td></tr>
              <tr><td>Balance per statement</td><td className="num">{fmtAmount(st.closingBalance)}</td></tr>
              <tr className={cn("font-bold", r.difference.isZero() ? "text-green-700" : "text-red-600")}><td>Difference</td><td className="num">{fmtAmount(r.difference)}</td></tr>
            </tbody>
          </table>
          {!r.difference.isZero() && <p className="mt-2 text-xs text-ink-soft">A difference usually means a missing or wrong book entry, or a wrong opening balance. Book entries before {fmtDate(r.start)} are treated as cleared.</p>}
        </Card>
        <div className="space-y-4 xl:col-span-2">
          <DataTable basePath={`/accounting/bank/${id}`} empty="No lines"
            columns={[{ label: "#" }, { label: "Date" }, { label: "Description" }, { label: "Reference" }, { label: "Amount", align: "right" }, { label: "Matched to" }, ...(open ? [{ label: "" }] : [])]}
            rows={st.lines.map((l) => {
              const c = (candidates.get(l.id) ?? []) as Awaited<ReturnType<typeof matchCandidates>>;
              return { key: l.id, className: l.journalLineId ? undefined : "bg-amber-50/60", cells: [
                l.lineNo, fmtDate(l.date), l.description, l.reference ?? "", <span key="a" className={D(l.amount).lt(0) ? "text-red-600" : ""}>{fmtAmount(l.amount)}</span>,
                l.journalLine ? <Link key="j" className="link" href={`/accounting/journals/${l.journalLine.journal.id}`}>{l.journalLine.journal.sourceNo ?? l.journalLine.journal.number}</Link> : <span key="u" className="text-amber-700">Unmatched</span>,
                ...(open ? [<span key="x" className="flex justify-end gap-1">
                  {l.journalLineId ? <ActionButton variant="outline" label="Unmatch" action={unmatchLineAction.bind(null, l.id)} /> : <>
                    {c.length > 0 && <QuickFormButton icon="none" label="Match" title={`Match line ${l.lineNo} (${fmtAmount(l.amount)})`} action={matchLineAction.bind(null, l.id)} initial={{ journalLineId: c[0].id }}
                      fields={[{ name: "journalLineId", label: "Ledger entry with the same amount", type: "select", required: true, options: c.map((x) => ({ value: x.id, label: `${fmtDate(x.date)} · ${x.journal.sourceNo ?? x.journal.number} · ${x.journal.memo ?? ""}`.slice(0, 120) })) }]} />}
                    <QuickFormButton icon="none" label="Book" title={`Book line ${l.lineNo} (${fmtAmount(l.amount)})`} action={bookStatementLineAction.bind(null, l.id)} initial={{ accountId: charges?.accountId ?? "", description: l.description }}
                      note="Posts this bank-only item (charges, interest, direct debit) against the chosen account and matches it."
                      fields={[{ name: "accountId", label: "Other account", type: "select", required: true, options: accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })) }, { name: "description", label: "Description" }]} />
                  </>}
                </span>] : []),
              ] };
            })} />
          {r.outstanding.length > 0 && <Card title="Book entries not yet on the bank" bodyClass="p-0">
            <DataTable basePath={`/accounting/bank/${id}`} columns={[{ label: "Date" }, { label: "Journal" }, { label: "Document / memo" }, { label: "Amount", align: "right" }]}
              rows={r.outstanding.map((o) => ({ key: o.id, cells: [fmtDate(o.date), <Link key="j" className="link" href={`/accounting/journals/${o.journal.id}`}>{o.journal.number}</Link>, o.journal.sourceNo ?? o.journal.memo, fmtAmount(D(o.debit).sub(D(o.credit)))] }))} />
          </Card>}
          {st.status === "RECONCILED" && <Notice tone="success">Reconciled on {fmtDate(st.reconciledAt)}.</Notice>}
        </div>
      </div>
    </>
  );
}
