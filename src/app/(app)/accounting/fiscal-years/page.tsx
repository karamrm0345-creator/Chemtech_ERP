import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listFiscalYears } from "@/server/services/accounting";
import { PageHeader, StatusBadge, Card, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ActionButton } from "@/components/forms/action-button";
import { QuickFormButton } from "@/components/forms/small-forms";
import { createFiscalYearAction, closeFiscalYearAction, reopenFiscalYearAction, setBooksLockAction } from "@/app/actions/accounting";
import { fmtDate, fmtDateTime, toDateInput } from "@/lib/format";

export const metadata = { title: "Fiscal years" };

export default async function FiscalYearsPage() {
  const user = await requireUser("accounting.view");
  const { years, booksLockedUntil } = await listFiscalYears(user);
  const manage = user.permissions.has("accounting.period.close");
  const lastClosed = years.find((y) => y.status === "CLOSED");
  return (
    <>
      <PageHeader title="Fiscal years & period close" subtitle="A calendar fiscal year is created automatically on first posting. Close years in order; closing moves profit to retained earnings."
        crumbs={[{ label: "Accounting" }, { label: "Fiscal years" }]}
        actions={manage && <QuickFormButton variant="action" label="New fiscal year" title="New fiscal year" action={createFiscalYearAction}
          fields={[{ name: "name", label: "Name (e.g. 2027 or FY2027-28)", required: true }, { name: "startDate", label: "Start date", type: "date", required: true }, { name: "endDate", label: "End date", type: "date", required: true }]} />} />
      <Card title="Books lock date" className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{booksLockedUntil ? <>Nothing can be posted on or before <b>{fmtDate(booksLockedUntil)}</b>. Use this to close a month after reporting.</> : "No lock date set: every open fiscal year accepts postings."}</p>
          {manage && <QuickFormButton icon="edit" label="Change lock date" title="Books lock date" action={setBooksLockAction} initial={{ date: booksLockedUntil ? toDateInput(booksLockedUntil) : "" }}
            note="Leave blank to remove the lock. It cannot be earlier than the end of the last closed fiscal year." fields={[{ name: "date", label: "Lock postings up to and including", type: "date" }]} />}
        </div>
      </Card>
      <DataTable basePath="/accounting/fiscal-years" empty="No fiscal years yet" emptyHint="One is created automatically when the first document is posted."
        columns={[{ label: "Fiscal year" }, { label: "Start" }, { label: "End" }, { label: "Status" }, { label: "Closed" }, { label: "Closing entry" }, ...(manage ? [{ label: "" }] : [])]}
        rows={years.map((y) => ({ key: y.id, cells: [
          <b key="n">{y.name}</b>, fmtDate(y.startDate), fmtDate(y.endDate), <StatusBadge key="s" status={y.status} />, y.closedAt ? fmtDateTime(y.closedAt) : "—",
          y.closingJournalId ? <Link key="j" className="link" href={`/accounting/journals/${y.closingJournalId}`}>View</Link> : "—",
          ...(manage ? [<span key="a" className="flex justify-end gap-2">
            {y.status === "OPEN" && <ActionButton variant="outline" label="Close year" confirm={`Close ${y.name}? Income and expense balances move to retained earnings and the year is locked. Post or cancel any draft journals first.`} action={closeFiscalYearAction.bind(null, y.id)} />}
            {y.status === "CLOSED" && lastClosed?.id === y.id && <ActionButton variant="danger" label="Reopen" prompt="Reason for reopening" promptRequired action={reopenFiscalYearAction.bind(null, y.id)} />}
          </span>] : []),
        ] }))} />
      <div className="mt-4"><Notice>Before closing a year: post all invoices, receipts and stock documents dated in it, review the trial balance, then close. Reopening reverses the closing entry and is recorded in the audit trail.</Notice></div>
    </>
  );
}
