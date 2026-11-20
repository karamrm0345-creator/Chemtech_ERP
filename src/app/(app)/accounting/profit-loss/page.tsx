import { requireUser } from "@/server/auth/session";
import { currentPeriod, profitAndLoss } from "@/server/services/accounting";
import { PageHeader } from "@/components/ui/primitives";
import { PeriodBar } from "@/components/ui/period-bar";
import { PrintButton } from "@/components/print-button";
import { str, type SP } from "@/lib/params";
import { fmtAmount, fmtDate, parseBusinessDate } from "@/lib/format";
import { StatementSection } from "../statement";

export const metadata = { title: "Profit & loss" };

export default async function ProfitLossPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("accounting.view");
  const sp = await searchParams;
  const def = await currentPeriod();
  const from = str(sp, "from") ?? def.from, to = str(sp, "to") ?? def.to;
  const pl = await profitAndLoss(user, { from: parseBusinessDate(from)!, to: parseBusinessDate(to)! });
  const q = `from=${from}&to=${to}`;
  return (
    <>
      <PageHeader title="Profit & loss" subtitle={`${fmtDate(parseBusinessDate(from))} – ${fmtDate(parseBusinessDate(to))} · base currency`}
        crumbs={[{ label: "Accounting" }, { label: "Profit & loss" }]} actions={<PrintButton />} />
      <PeriodBar defaults={{ from, to }} />
      <div className="max-w-3xl space-y-4">
        <StatementSection title="Income" nodes={pl.nodes.filter((n) => n.type === "INCOME")} total={pl.income} totalLabel="Total income" query={q} />
        <StatementSection title="Expenses" nodes={pl.nodes.filter((n) => n.type === "EXPENSE")} total={pl.expense} totalLabel="Total expenses" query={q} />
        <div className={`card flex items-center justify-between px-4 py-3 text-lg font-bold ${pl.netProfit.isNeg() ? "text-red-600" : "text-green-700"}`}>
          <span>{pl.netProfit.isNeg() ? "Net loss" : "Net profit"}</span><span className="num">{fmtAmount(pl.netProfit)}</span>
        </div>
      </div>
    </>
  );
}
