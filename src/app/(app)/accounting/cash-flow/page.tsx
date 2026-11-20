import { Fragment } from "react";
import { requireUser } from "@/server/auth/session";
import { cashFlow } from "@/server/services/period-end";
import { currentPeriod } from "@/server/services/accounting";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { PeriodBar } from "@/components/ui/period-bar";
import { PrintButton } from "@/components/print-button";
import { str, type SP } from "@/lib/params";
import { fmtAmount, fmtDate, parseBusinessDate } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Cash flow statement" };
const TITLES = { OPERATING: "Operating activities", INVESTING: "Investing activities", FINANCING: "Financing activities" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("accounting.view");
  const sp = await searchParams;
  const def = await currentPeriod();
  const from = str(sp, "from") ?? def.from, to = str(sp, "to") ?? def.to;
  const cf = await cashFlow(user, { from: parseBusinessDate(from)!, to: parseBusinessDate(to)! });
  return (
    <>
      <PageHeader title="Cash flow statement" subtitle={`${fmtDate(cf.from)} – ${fmtDate(cf.to)} · direct method from bank and cash accounts`} crumbs={[{ label: "Accounting" }, { label: "Cash flow" }]} actions={<PrintButton />} />
      <PeriodBar defaults={{ from, to }} />
      {!cf.difference.isZero() && <div className="mb-4"><Notice tone="danger">The statement does not agree with the cash accounts by {fmtAmount(cf.difference)}.</Notice></div>}
      <div className="card max-w-3xl overflow-hidden">
        <table className="table-base">
          <tbody>
            <tr className="font-semibold"><td>Cash and bank at {fmtDate(cf.from)}</td><td className="num">{fmtAmount(cf.opening)}</td></tr>
            {(["OPERATING", "INVESTING", "FINANCING"] as const).map((s) => (
              <Fragment key={s}>
                <tr className="bg-panel/60"><td colSpan={2} className="text-xs font-bold uppercase tracking-wide text-ink-soft">{TITLES[s]}</td></tr>
                {cf.rows.filter((r) => r.section === s).map((r) => <tr key={`${s}-${r.label}`}><td className="pl-8">{r.label}</td><td className={cn("num", r.amount.lt(0) && "text-red-600")}>{fmtAmount(r.amount)}</td></tr>)}
                <tr className="font-semibold"><td>Net cash from {TITLES[s].toLowerCase()}</td><td className="num">{fmtAmount(cf.totals[s])}</td></tr>
              </Fragment>
            ))}
            <tr className="font-semibold"><td>Net change in cash</td><td className="num">{fmtAmount(cf.net)}</td></tr>
            <tr className="bg-panel/60 font-bold"><td>Cash and bank at {fmtDate(cf.to)}</td><td className="num">{fmtAmount(cf.closing)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 max-w-3xl text-xs text-ink-soft">Each bank or cash movement is classified by the other side of its journal. Accounts are operating unless marked Investing or Financing in the chart of accounts. Transfers between bank accounts cancel out.</p>
    </>
  );
}
