import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { revaluationPreview } from "@/server/services/period-end";
import { PageHeader, Card, Notice, btn } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ActionButton } from "@/components/forms/action-button";
import { postRevaluationAction } from "@/app/actions/accounting";
import { str, type SP } from "@/lib/params";
import { fmtAmount, fmtDate, parseBusinessDate, toDateInput } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Foreign-currency revaluation" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("accounting.view");
  const sp = await searchParams;
  const now = new Date();
  const date = str(sp, "date") ?? toDateInput(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
  const settings = await prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } });
  const currencies = await prisma.currency.findMany({ where: { active: true, NOT: { code: settings.baseCurrency } }, orderBy: { code: "asc" } });
  const rates = Object.fromEntries(currencies.map((c) => [c.code, str(sp, c.code) ?? c.rateToBase.toString()]));
  const pv = await revaluationPreview(user, parseBusinessDate(date)!, rates);
  const done = await prisma.journalEntry.findMany({ where: { type: "REVALUATION", reversalOfId: null }, orderBy: { date: "desc" }, take: 6 });
  return (
    <>
      <PageHeader title="Foreign-currency revaluation" subtitle="At month or year end, restate open foreign-currency receivables, payables and unapplied credits at the closing rate. The entry reverses automatically the next day."
        crumbs={[{ label: "Accounting" }, { label: "FX revaluation" }]} />
      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm"><span className="label">Revaluation date</span><input type="date" name="date" defaultValue={date} className="input w-auto" /></label>
          {currencies.map((c) => <label key={c.code} className="text-sm"><span className="label">1 {c.code} = ? {settings.baseCurrency}</span><input name={c.code} defaultValue={rates[c.code]} inputMode="decimal" className="input w-32 text-right" /></label>)}
          <button className={btn("outline")}>Preview</button>
        </form>
      </Card>
      {pv.rows.length === 0 ? <Notice>No open foreign-currency items need revaluing at {fmtDate(pv.asOf)}.</Notice> : <>
        <DataTable basePath="/accounting/revaluation" columns={[{ label: "Document" }, { label: "Ledger" }, { label: "Open amount", align: "right" }, { label: "Booked rate", align: "right" }, { label: "New rate", align: "right" }, { label: "Gain / (loss)", align: "right" }]}
          rows={[...pv.rows.map((r, i) => ({ key: `${r.label}-${i}`, cells: [r.label, r.side === "AR" ? "Receivable" : "Payable", `${r.currency} ${fmtAmount(r.open)}${r.sign < 0 ? " (credit)" : ""}`, r.rate.toString(), r.newRate.toString(),
            <span key="g" className={cn(r.gain.lt(0) && "text-red-600")}>{fmtAmount(r.gain)}</span>] })),
            { key: "t", className: "bg-panel/60 font-semibold", cells: ["Total unrealised", "", "", "", "", fmtAmount(pv.total)] }]} />
        {user.permissions.has("accounting.journal.post") && <div className="mt-4 flex justify-end">
          <ActionButton variant="action" label={`Post revaluation at ${fmtDate(pv.asOf)}`} confirm={`Post a net ${pv.total.lt(0) ? "loss" : "gain"} of ${fmtAmount(pv.total.abs())} to Unrealised exchange differences, reversed on the next day?`}
            action={postRevaluationAction.bind(null, { date, rates })} />
        </div>}
      </>}
      {done.length > 0 && <Card title="Recent revaluations" className="mt-4" bodyClass="p-0">
        <DataTable basePath="/accounting/revaluation" columns={[{ label: "Journal" }, { label: "Date" }, { label: "Amount", align: "right" }]}
          rows={done.map((j) => ({ key: j.id, cells: [<Link key="j" className="link" href={`/accounting/journals/${j.id}`}>{j.number}</Link>, fmtDate(j.date), fmtAmount(j.totalDebit)] }))} />
      </Card>}
    </>
  );
}
