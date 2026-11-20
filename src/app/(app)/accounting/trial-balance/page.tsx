import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { currentPeriod, trialBalance } from "@/server/services/accounting";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { PeriodBar } from "@/components/ui/period-bar";
import { PrintButton } from "@/components/print-button";
import { str, type SP } from "@/lib/params";
import { fmtAmount, fmtDate, humanize, parseBusinessDate } from "@/lib/format";
import type { Dec } from "@/lib/decimal";

export const metadata = { title: "Trial balance" };
const amt = (v: Dec) => (v.isZero() ? "" : fmtAmount(v));

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("accounting.view");
  const sp = await searchParams;
  const def = await currentPeriod();
  const from = str(sp, "from") ?? def.from, to = str(sp, "to") ?? def.to;
  const tb = await trialBalance(user, { from: parseBusinessDate(from)!, to: parseBusinessDate(to)! });
  const t = tb.totals;
  const balanced = t.closingDr.equals(t.closingCr) && t.debit.equals(t.credit);
  return (
    <>
      <PageHeader title="Trial balance" subtitle={`${fmtDate(parseBusinessDate(from))} – ${fmtDate(parseBusinessDate(to))} · base currency`}
        crumbs={[{ label: "Accounting" }, { label: "Trial balance" }]} actions={<PrintButton />} />
      <PeriodBar defaults={{ from, to }} />
      {!balanced && <div className="mb-4"><Notice tone="danger">The trial balance does not balance. Contact your system administrator.</Notice></div>}
      <DataTable basePath="/accounting/trial-balance" empty="No postings"
        columns={[{ label: "Code" }, { label: "Account" }, { label: "Type" }, { label: "Opening Dr", align: "right" }, { label: "Opening Cr", align: "right" }, { label: "Debit", align: "right" }, { label: "Credit", align: "right" }, { label: "Closing Dr", align: "right" }, { label: "Closing Cr", align: "right" }]}
        rows={[...tb.rows.map((r) => ({ key: r.id, cells: [
          <span key="c" className="font-mono text-xs">{r.code}</span>, <Link key="n" className="link" href={`/accounting/ledger?account=${r.id}&from=${from}&to=${to}`}>{r.name}</Link>, humanize(r.type),
          amt(r.openingDr), amt(r.openingCr), amt(r.debit), amt(r.credit), amt(r.closingDr), amt(r.closingCr),
        ] })), { key: "total", className: "bg-panel/60 font-semibold", cells: ["", "Total", "", fmtAmount(t.openingDr), fmtAmount(t.openingCr), fmtAmount(t.debit), fmtAmount(t.credit), fmtAmount(t.closingDr), fmtAmount(t.closingCr)] }]} />
    </>
  );
}
