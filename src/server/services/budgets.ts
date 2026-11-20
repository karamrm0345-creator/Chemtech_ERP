/**
 * Budgets per fiscal year (optionally per cost centre) for income and expense
 * accounts, by month, and budget-versus-actual from the posted ledger.
 */
import { z } from "zod";
import { prisma, withTx } from "../db";
import { requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { AppError } from "../errors";
import { optId, optStr, reqStr, decimalStr } from "@/lib/validation";
import { D, ZERO, round2, type Dec } from "@/lib/decimal";
import { ledgerDate } from "../accounting/ledger";
import { assertCostCenters } from "./accounting";

/** Month starts of a fiscal year (period 1 = first month). */
export function fiscalMonths(fy: { startDate: Date; endDate: Date }) {
  const out: Date[] = [];
  for (let d = new Date(Date.UTC(fy.startDate.getUTCFullYear(), fy.startDate.getUTCMonth(), 1)); d <= fy.endDate; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) out.push(d);
  return out;
}

export const budgetSchema = z.object({
  name: reqStr(120),
  fiscalYearId: reqStr(40),
  costCenterId: optId,
  notes: optStr(1000),
  lines: z.array(z.object({
    accountId: reqStr(40),
    annual: decimalStr.optional(), // spread evenly over the months when monthly amounts are not given
    monthly: z.array(decimalStr).optional(),
  })).default([]),
});

export async function saveBudget(ctx: Ctx, id: string | null, raw: unknown) {
  requirePerm(ctx, "accounting.budget.manage");
  const d = budgetSchema.parse(raw);
  return withTx(async (tx) => {
    const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id: d.fiscalYearId } });
    await assertCostCenters(tx, [d.costCenterId]);
    const months = fiscalMonths(fy).length;
    const accounts = await tx.account.findMany({ where: { id: { in: d.lines.map((l) => l.accountId) } } });
    const rows: { accountId: string; period: number; amount: Dec }[] = [];
    for (const l of d.lines) {
      const a = accounts.find((x) => x.id === l.accountId);
      if (!a || a.isGroup || !["INCOME", "EXPENSE"].includes(a.type)) throw new AppError("Budgets are set on income and expense accounts (not groups).");
      let amounts: Dec[];
      if (l.monthly?.length) {
        if (l.monthly.length !== months) throw new AppError(`${a.code}: enter ${months} monthly amounts.`);
        amounts = l.monthly.map((m) => round2(D(m)));
      } else {
        const annual = round2(D(l.annual));
        const each = round2(annual.div(months));
        amounts = Array.from({ length: months }, (_, i) => (i === months - 1 ? annual.sub(each.mul(months - 1)) : each));
      }
      amounts.forEach((amount, i) => { if (!amount.isZero()) rows.push({ accountId: a.id, period: i + 1, amount }); });
    }
    const dup = await tx.budget.findFirst({ where: { fiscalYearId: fy.id, costCenterId: d.costCenterId ?? null, name: d.name, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw new AppError(`A budget named ${d.name} already exists for this year and cost centre.`);
    const data = { name: d.name, fiscalYearId: fy.id, costCenterId: d.costCenterId ?? null, notes: d.notes };
    const b = id ? await tx.budget.update({ where: { id }, data }) : await tx.budget.create({ data: { ...data, createdById: ctx.userId } });
    await tx.budgetLine.deleteMany({ where: { budgetId: b.id } });
    if (rows.length) await tx.budgetLine.createMany({ data: rows.map((r) => ({ ...r, budgetId: b.id })) });
    const total = rows.reduce((s, r) => s.add(r.amount), ZERO);
    await audit(tx, ctx, { action: id ? "UPDATE" : "CREATE", entity: "Budget", entityId: b.id, summary: `${id ? "Updated" : "Created"} budget ${b.name} for ${fy.name} (${rows.length} entries, total ${total.toFixed(2)})` });
    return b;
  });
}

/** Budget versus actual for the budget's months that fall inside [from, to] (whole months). */
export async function budgetVsActual(ctx: Ctx, budgetId: string, opts: { from?: Date; to?: Date } = {}) {
  requirePerm(ctx, "accounting.view");
  const b = await prisma.budget.findUnique({ where: { id: budgetId }, include: { fiscalYear: true, costCenter: true, lines: true } });
  if (!b) return null;
  const months = fiscalMonths(b.fiscalYear);
  const from = opts.from ? ledgerDate(opts.from) : b.fiscalYear.startDate;
  const to = opts.to ? ledgerDate(opts.to) : b.fiscalYear.endDate;
  const inRange = new Set(months.map((m, i) => ({ m, p: i + 1 })).filter(({ m }) => {
    const end = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
    return end >= from && m <= to;
  }).map(({ p }) => p));
  if (!inRange.size) throw new AppError("The selected dates are outside this budget's fiscal year.");
  const firstP = Math.min(...inRange), lastP = Math.max(...inRange);
  const periodStart = months[firstP - 1];
  const periodEnd = new Date(Date.UTC(months[lastP - 1].getUTCFullYear(), months[lastP - 1].getUTCMonth() + 1, 0));
  const budget = new Map<string, Dec>();
  for (const l of b.lines) if (inRange.has(l.period)) budget.set(l.accountId, (budget.get(l.accountId) ?? ZERO).add(D(l.amount)));
  const g = await prisma.journalLine.groupBy({
    by: ["accountId"], _sum: { debit: true, credit: true },
    where: {
      posted: true, date: { gte: periodStart, lte: periodEnd }, journal: { type: { not: "CLOSING" } }, account: { type: { in: ["INCOME", "EXPENSE"] } },
      ...(b.costCenterId ? { costCenterId: b.costCenterId } : {}),
    },
  });
  const ids = [...new Set([...budget.keys(), ...g.map((r) => r.accountId)])];
  const accounts = await prisma.account.findMany({ where: { id: { in: ids } } });
  const rows = accounts.map((a) => {
    const s = g.find((r) => r.accountId === a.id);
    const actual = s ? (a.type === "INCOME" ? D(s._sum.credit).sub(D(s._sum.debit)) : D(s._sum.debit).sub(D(s._sum.credit))) : ZERO;
    const plan = budget.get(a.id) ?? ZERO;
    const variance = actual.sub(plan);
    // Favourable: income above budget, expense below budget.
    const favourable = a.type === "INCOME" ? !variance.lt(0) : !variance.gt(0);
    return { id: a.id, code: a.code, name: a.name, type: a.type, budget: plan, actual, variance, pct: plan.isZero() ? null : variance.div(plan).mul(100).toDecimalPlaces(1), favourable };
  }).sort((x, y) => (x.type === y.type ? x.code.localeCompare(y.code) : x.type === "INCOME" ? -1 : 1));
  const sum = (t: string, k: "budget" | "actual") => rows.filter((r) => r.type === t).reduce((s, r) => s.add(r[k]), ZERO);
  const totals = {
    income: { budget: sum("INCOME", "budget"), actual: sum("INCOME", "actual") },
    expense: { budget: sum("EXPENSE", "budget"), actual: sum("EXPENSE", "actual") },
  };
  return { budget: b, periodStart, periodEnd, rows, totals, net: { budget: totals.income.budget.sub(totals.expense.budget), actual: totals.income.actual.sub(totals.expense.actual) } };
}

export async function listBudgets(ctx: Ctx) {
  requirePerm(ctx, "accounting.view");
  const rows = await prisma.budget.findMany({ include: { fiscalYear: true, costCenter: true, lines: { select: { amount: true, account: { select: { type: true } } } } }, orderBy: [{ fiscalYear: { startDate: "desc" } }, { name: "asc" }] });
  return rows.map((b) => ({
    ...b,
    income: b.lines.filter((l) => l.account.type === "INCOME").reduce((s, l) => s.add(D(l.amount)), ZERO),
    expense: b.lines.filter((l) => l.account.type === "EXPENSE").reduce((s, l) => s.add(D(l.amount)), ZERO),
  }));
}
