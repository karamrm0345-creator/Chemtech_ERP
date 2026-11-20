import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { currentPeriod, generalLedger } from "@/server/services/accounting";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { PeriodBar } from "@/components/ui/period-bar";
import { PrintButton } from "@/components/print-button";
import { str, type SP } from "@/lib/params";
import { fmtAmount, fmtDate, parseBusinessDate } from "@/lib/format";
import { sourceHref } from "@/lib/accounting-links";
import { D } from "@/lib/decimal";

export const metadata = { title: "General ledger" };

export default async function LedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("accounting.view");
  const sp = await searchParams;
  const def = await currentPeriod();
  const from = str(sp, "from") ?? def.from, to = str(sp, "to") ?? def.to;
  const accountId = str(sp, "account");
  const partyType = str(sp, "partyType"), partyId = str(sp, "party");
  const accounts = await prisma.account.findMany({ where: { isGroup: false }, orderBy: { code: "asc" } });
  const gl = accountId || partyId ? await generalLedger(user, { accountId, partyType, partyId, from: parseBusinessDate(from)!, to: parseBusinessDate(to)! }) : null;
  return (
    <>
      <PageHeader title={gl?.account ? `${gl.account.code} ${gl.account.name}` : "General ledger"} subtitle={`Posted entries ${fmtDate(parseBusinessDate(from))} – ${fmtDate(parseBusinessDate(to))}, base currency`}
        crumbs={[{ label: "Accounting" }, { label: "General ledger" }]} actions={<PrintButton />} />
      <PeriodBar defaults={{ from, to }} selects={[{ name: "account", label: "Choose an account…", options: accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })) }]} />
      {!gl ? <Notice>Choose an account to see its ledger.</Notice> : (
        <DataTable basePath="/accounting/ledger" empty="No entries in this period"
          columns={[{ label: "Date" }, { label: "Journal" }, { label: "Document" }, { label: "Party" }, { label: "Description" }, ...(accountId ? [] : [{ label: "Account" }]), { label: "Debit", align: "right" }, { label: "Credit", align: "right" }, { label: "Balance (Dr − Cr)", align: "right" }]}
          rows={[
            { key: "open", className: "bg-panel/60 font-semibold", cells: ["", "Opening balance", "", "", "", ...(accountId ? [] : [""]), "", "", fmtAmount(gl.opening)] },
            ...gl.rows.map((r) => {
              const src = sourceHref(r.journal.sourceType, r.journal.sourceId);
              return { key: r.id, cells: [
                fmtDate(r.date), <Link key="j" className="link" href={`/accounting/journals/${r.journal.id}`}>{r.journal.number}</Link>,
                src ? <Link key="s" className="link" href={src}>{r.journal.sourceNo}</Link> : r.journal.sourceNo, r.party, r.description ?? r.journal.memo,
                ...(accountId ? [] : [`${r.account.code} ${r.account.name}`]),
                D(r.debit).isZero() ? "" : fmtAmount(r.debit), D(r.credit).isZero() ? "" : fmtAmount(r.credit), fmtAmount(r.balance),
              ] };
            }),
            { key: "close", className: "bg-panel/60 font-semibold", cells: ["", "Closing balance", "", "", "", ...(accountId ? [] : [""]), fmtAmount(gl.totals.debit), fmtAmount(gl.totals.credit), fmtAmount(gl.closing)] },
          ]} />
      )}
    </>
  );
}
