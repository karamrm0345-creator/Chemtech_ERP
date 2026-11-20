import { requireUser } from "@/server/auth/session";
import { balanceSheet, currentPeriod } from "@/server/services/accounting";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { PeriodBar } from "@/components/ui/period-bar";
import { PrintButton } from "@/components/print-button";
import { str, type SP } from "@/lib/params";
import { fmtAmount, fmtDate, parseBusinessDate } from "@/lib/format";
import { StatementSection } from "../statement";

export const metadata = { title: "Balance sheet" };

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("accounting.view");
  const sp = await searchParams;
  const asOf = str(sp, "asOf") ?? (await currentPeriod()).to;
  const bs = await balanceSheet(user, { asOf: parseBusinessDate(asOf)! });
  const q = `from=2000-01-01&to=${asOf}`;
  return (
    <>
      <PageHeader title="Balance sheet" subtitle={`As of ${fmtDate(parseBusinessDate(asOf))} · base currency`} crumbs={[{ label: "Accounting" }, { label: "Balance sheet" }]} actions={<PrintButton />} />
      <PeriodBar mode="asOf" defaults={{ asOf }} />
      {!bs.difference.isZero() && <div className="mb-4"><Notice tone="danger">Assets differ from liabilities and equity by {fmtAmount(bs.difference)}. Contact your system administrator.</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <StatementSection title="Assets" nodes={bs.nodes.filter((n) => n.type === "ASSET")} total={bs.assets} totalLabel="Total assets" query={q} />
        <div className="space-y-4">
          <StatementSection title="Liabilities" nodes={bs.nodes.filter((n) => n.type === "LIABILITY")} total={bs.liabilities} totalLabel="Total liabilities" query={q} />
          <StatementSection title="Equity" nodes={bs.nodes.filter((n) => n.type === "EQUITY")} total={bs.equity} totalLabel="Total equity (before current earnings)" query={q} />
          <div className="card divide-y divide-line text-sm">
            <div className="flex justify-between px-4 py-2.5"><span>Profit not yet closed to retained earnings</span><span className="num">{fmtAmount(bs.unclosedProfit)}</span></div>
            <div className="flex justify-between px-4 py-2.5 font-bold"><span>Total liabilities and equity</span><span className="num">{fmtAmount(bs.liabilitiesAndEquity)}</span></div>
          </div>
        </div>
      </div>
    </>
  );
}
