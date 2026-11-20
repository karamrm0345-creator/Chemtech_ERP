import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { budgetVsActual, fiscalMonths } from "@/server/services/budgets";
import { PageHeader, Card, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { PeriodBar } from "@/components/ui/period-bar";
import { PrintButton } from "@/components/print-button";
import { str, type SP } from "@/lib/params";
import { fmtAmount, fmtDate, parseBusinessDate, toDateInput } from "@/lib/format";
import { D } from "@/lib/decimal";
import { cn } from "@/lib/cn";
import { BudgetEditor } from "./editor";

export const metadata = { title: "Budget" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await requireUser("accounting.view");
  const { id } = await params;
  const sp = await searchParams;
  const b = await prisma.budget.findUnique({ where: { id }, include: { fiscalYear: true, costCenter: true, lines: true } });
  if (!b) notFound();
  const from = str(sp, "from") ?? b.fiscalYear.startDate.toISOString().slice(0, 10);
  const to = str(sp, "to") ?? b.fiscalYear.endDate.toISOString().slice(0, 10);
  let report: Awaited<ReturnType<typeof budgetVsActual>> = null; let error: string | null = null;
  try { report = await budgetVsActual(user, id, { from: parseBusinessDate(from)!, to: parseBusinessDate(to)! }); } catch (e) { error = (e as Error).message; }
  const accounts = await prisma.account.findMany({ where: { isGroup: false, active: true, type: { in: ["INCOME", "EXPENSE"] } }, orderBy: { code: "asc" } });
  const annual = new Map<string, number>();
  for (const l of b.lines) annual.set(l.accountId, (annual.get(l.accountId) ?? 0) + Number(l.amount));
  const months = fiscalMonths(b.fiscalYear).length;
  return (
    <>
      <PageHeader title={b.name} subtitle={`${b.fiscalYear.name} · ${b.costCenter ? `${b.costCenter.code} ${b.costCenter.name}` : "Whole company"}`}
        crumbs={[{ label: "Accounting" }, { label: "Budgets", href: "/accounting/budgets" }, { label: b.name }]} actions={<PrintButton />} />
      <PeriodBar defaults={{ from, to }} />
      {error ? <Notice tone="warning">{error}</Notice> : report && (
        <div className="mb-4">
          <p className="mb-2 text-sm text-ink-soft">Budget versus actual, {fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)} (whole months{b.costCenter ? `, entries tagged ${b.costCenter.code}` : ""}).</p>
          <DataTable basePath={`/accounting/budgets/${id}`} empty="No budget or actual figures in this period"
            columns={[{ label: "Account" }, { label: "Budget", align: "right" }, { label: "Actual", align: "right" }, { label: "Variance", align: "right" }, { label: "%", align: "right" }]}
            rows={[...report.rows.map((r) => ({ key: r.id, cells: [
              <span key="a"><span className="font-mono text-xs">{r.code}</span> {r.name}</span>, fmtAmount(r.budget), fmtAmount(r.actual),
              <span key="v" className={cn("font-semibold", r.favourable ? "text-green-700" : "text-red-600")}>{fmtAmount(r.variance)}</span>, r.pct === null ? "—" : `${r.pct.toString()}%`,
            ] })),
            { key: "net", className: "bg-panel/60 font-semibold", cells: ["Result (income − expense)", fmtAmount(report.net.budget), fmtAmount(report.net.actual), fmtAmount(D(report.net.actual).sub(D(report.net.budget))), ""] }]} />
        </div>
      )}
      {user.permissions.has("accounting.budget.manage") ? (
        <BudgetEditor budget={{ id: b.id, name: b.name, fiscalYearId: b.fiscalYearId, costCenterId: b.costCenterId, notes: b.notes }} months={months}
          accounts={accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}`, type: a.type }))}
          rows={[...annual].map(([accountId, v]) => ({ accountId, annual: v.toFixed(2) }))} />
      ) : <Card><p className="text-sm text-ink-soft">Budget set {toDateInput(b.updatedAt)}.</p></Card>}
    </>
  );
}
