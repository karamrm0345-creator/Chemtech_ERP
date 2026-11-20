import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listStatements } from "@/server/services/bank";
import { PageHeader, StatusBadge, LinkButton } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { fmtAmount, fmtDate } from "@/lib/format";

export const metadata = { title: "Bank reconciliation" };

export default async function Page() {
  const user = await requireUser("accounting.view");
  const rows = await listStatements(user);
  return (
    <>
      <PageHeader title="Bank reconciliation" subtitle="Import each bank statement, match it to the ledger, book bank charges, and prove the bank balance."
        crumbs={[{ label: "Accounting" }, { label: "Bank reconciliation" }]}
        actions={user.permissions.has("accounting.bank.reconcile") && <LinkButton variant="action" href="/accounting/bank/import">Import statement</LinkButton>} />
      <DataTable basePath="/accounting/bank" empty="No statements imported" emptyHint="Export your bank statement as CSV and import it here."
        columns={[{ label: "Statement" }, { label: "Account" }, { label: "Date" }, { label: "Opening", align: "right" }, { label: "Closing", align: "right" }, { label: "Lines", align: "right" }, { label: "Unmatched", align: "right" }, { label: "Status" }]}
        rows={rows.map((s) => ({ key: s.id, cells: [<Link key="r" className="link" href={`/accounting/bank/${s.id}`}>{s.reference}</Link>, `${s.account.code} ${s.account.name}`, fmtDate(s.statementDate), fmtAmount(s.openingBalance), fmtAmount(s.closingBalance), s._count.lines, s.unmatched || "—", <StatusBadge key="s" status={s.status} />] }))} />
    </>
  );
}
