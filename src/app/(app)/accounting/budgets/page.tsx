import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { listBudgets } from "@/server/services/budgets";
import { PageHeader } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { QuickFormButton } from "@/components/forms/small-forms";
import { saveBudgetAction } from "@/app/actions/accounting";
import { fmtAmount } from "@/lib/format";

export const metadata = { title: "Budgets" };

export default async function Page() {
  const user = await requireUser("accounting.view");
  const [budgets, years, centres] = await Promise.all([
    listBudgets(user),
    prisma.fiscalYear.findMany({ where: { status: "OPEN" }, orderBy: { startDate: "desc" } }),
    prisma.costCenter.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
  ]);
  const create = async (data: Record<string, string>) => { "use server"; return saveBudgetAction(null, { ...data, lines: [] }); };
  return (
    <>
      <PageHeader title="Budgets" subtitle="Plan income and expense by account for a fiscal year, for the whole company or one cost centre, and compare with actual results."
        crumbs={[{ label: "Accounting" }, { label: "Budgets" }]}
        actions={user.permissions.has("accounting.budget.manage") && <QuickFormButton variant="action" label="New budget" title="New budget" action={create} redirectBase="/accounting/budgets"
          initial={{ fiscalYearId: years[0]?.id ?? "" }} fields={[{ name: "name", label: "Name (e.g. Annual plan)", required: true },
            { name: "fiscalYearId", label: "Fiscal year", type: "select", required: true, options: years.map((y) => ({ value: y.id, label: y.name })) },
            { name: "costCenterId", label: "Cost centre (blank = whole company)", type: "select", options: centres.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` })) }]} />} />
      <DataTable basePath="/accounting/budgets" empty="No budgets yet" emptyHint="Create a budget, then enter annual amounts per account."
        columns={[{ label: "Budget" }, { label: "Fiscal year" }, { label: "Cost centre" }, { label: "Budgeted income", align: "right" }, { label: "Budgeted expense", align: "right" }, { label: "Budgeted result", align: "right" }]}
        rows={budgets.map((b) => ({ key: b.id, cells: [<Link key="n" className="link" href={`/accounting/budgets/${b.id}`}>{b.name}</Link>, b.fiscalYear.name, b.costCenter ? `${b.costCenter.code} ${b.costCenter.name}` : "Whole company", fmtAmount(b.income), fmtAmount(b.expense), fmtAmount(b.income.sub(b.expense))] }))} />
    </>
  );
}
