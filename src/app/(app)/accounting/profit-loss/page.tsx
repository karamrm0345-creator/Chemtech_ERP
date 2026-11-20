import { requireUser } from "@/server/auth/session";
import { currentPeriod, listCostCenters, profitAndLoss } from "@/server/services/accounting";
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
  const costCenterId = str(sp, "costCenter");
  const [pl, centres] = await Promise.all([profitAndLoss(user, { from: parseBusinessDate(from)!, to: parseBusinessDate(to)!, costCenterId }), listCostCenters({ includeInactive: true })]);
  const cc = centres.find((c) => c.id === costCenterId);
  const q = `from=${from}&to=${to}${costCenterId ? `&costCenter=${costCenterId}` : ""}`;
  return (
    <>
      <PageHeader title={cc ? `Profit & loss · ${cc.name}` : "Profit & loss"} subtitle={`${fmtDate(parseBusinessDate(from))} – ${fmtDate(parseBusinessDate(to))} · base currency${cc ? " · only entries tagged with this cost centre" : ""}`}
        crumbs={[{ label: "Accounting" }, { label: "Profit & loss" }]} actions={<PrintButton />} />
      <PeriodBar defaults={{ from, to }} selects={centres.length ? [{ name: "costCenter", label: "All cost centres", options: centres.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` })) }] : []} />
      <div className="max-w-3xl space-y-4">
        <StatementSection title="Income" nodes={pl.nodes.filter((n) => n.type === "INCOME")} total={pl.income} totalLabel="Total income" query={q} />
        <StatementSection title="Expenses" nodes={pl.nodes.filter((n) => n.type === "EXPENSE")} total={pl.expense} totalLabel="Total expenses" query={q} />
        <div className={`card flex items-center justify-between px-4 py-3 text-lg font-bold ${pl.netProfit.lt(0) ? "text-red-600" : "text-green-700"}`}>
          <span>{pl.netProfit.lt(0) ? "Net loss" : "Net profit"}</span><span className="num">{fmtAmount(pl.netProfit)}</span>
        </div>
      </div>
    </>
  );
}
