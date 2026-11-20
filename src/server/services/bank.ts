/**
 * Bank reconciliation: import a bank statement, match its lines to ledger
 * lines on the bank account (automatically by amount, date and reference, or
 * by hand), book bank-only items such as charges, and prove the statement
 * balance against the books.
 */
import { z } from "zod";
import { prisma, withTx, type Tx } from "../db";
import { requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { AppError } from "../errors";
import { decimalStr, optDate, optStr, reqStr } from "@/lib/validation";
import { D, ZERO, round2, type Dec } from "@/lib/decimal";
import { fmtDate } from "@/lib/format";
import { ledgerDate, postJournal, reverseJournal } from "../accounting/ledger";

const MATCH_WINDOW_DAYS = 10;

/** Parses yyyy-mm-dd, dd/mm/yyyy, dd-mm-yyyy or dd.mm.yyyy into a ledger date. */
export function parseStatementDate(s: string): Date | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return new Date(Date.UTC(y, +m[2] - 1, +m[1])); }
  return null;
}

/** Splits one CSV line, honouring double-quoted fields. */
function csvCells(line: string, sep: string) {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const num = (s: string | undefined) => {
  if (!s) return ZERO;
  const neg = /^\(.*\)$/.test(s.trim()) || /-$/.test(s.trim());
  const v = s.replace(/[(),\s]|QAR/gi, "").replace(/-$/, "");
  if (v === "" || isNaN(Number(v))) return ZERO;
  return neg ? D(v).abs().neg() : D(v);
};

/**
 * Reads a bank CSV export. Needs a header row with a date column, a description
 * column and either one signed Amount column or separate Debit / Credit
 * (Withdrawal / Deposit) columns. A Reference column is optional.
 */
export function parseStatementCsv(text: string) {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) throw new AppError("The file has no statement lines.");
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const head = csvCells(lines[0], sep).map((h) => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = col("date"), iDesc = col("description", "details", "narrative", "particulars", "memo");
  const iRef = col("reference", "ref", "cheque");
  const iAmt = head.findIndex((h) => h === "amount" || h.startsWith("amount"));
  const iOut = col("debit", "withdrawal", "paid out", "money out");
  const iIn = col("credit", "deposit", "paid in", "money in");
  if (iDate < 0 || iDesc < 0 || (iAmt < 0 && (iIn < 0 || iOut < 0))) {
    throw new AppError("The CSV needs Date and Description columns and either an Amount column or Debit and Credit columns.");
  }
  return lines.slice(1).map((l, n) => {
    const c = csvCells(l, sep);
    const date = parseStatementDate(c[iDate] ?? "");
    if (!date) throw new AppError(`Row ${n + 2}: unrecognised date "${c[iDate] ?? ""}".`);
    const amount = iAmt >= 0 ? num(c[iAmt]) : num(c[iIn]).abs().sub(num(c[iOut]).abs());
    return { date, description: (c[iDesc] || "—").slice(0, 300), reference: iRef >= 0 ? c[iRef]?.slice(0, 100) || null : null, amount: round2(amount) };
  }).filter((r) => !r.amount.isZero());
}

export const statementSchema = z.object({
  accountId: reqStr(40),
  reference: reqStr(100),
  statementDate: optDate,
  openingBalance: decimalStr,
  closingBalance: decimalStr,
  csv: optStr(2_000_000),
  lines: z.array(z.object({ date: optDate, description: reqStr(300), reference: optStr(100), amount: decimalStr })).default([]),
});

export async function importStatement(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "accounting.bank.reconcile");
  const d = statementSchema.parse(raw);
  const parsed = d.csv ? parseStatementCsv(d.csv) : d.lines.map((l) => ({ date: ledgerDate(l.date ?? new Date()), description: l.description, reference: l.reference ?? null, amount: round2(D(l.amount)) }));
  if (!parsed.length) throw new AppError("Add at least one statement line.");
  const opening = round2(D(d.openingBalance)), closing = round2(D(d.closingBalance));
  const movement = parsed.reduce((s, l) => s.add(l.amount), ZERO);
  if (!opening.add(movement).equals(closing)) {
    throw new AppError(`Opening ${opening.toFixed(2)} + lines ${movement.toFixed(2)} = ${opening.add(movement).toFixed(2)}, but the closing balance is ${closing.toFixed(2)}. Check the file or the balances.`);
  }
  const statementDate = d.statementDate ? ledgerDate(d.statementDate) : parsed.reduce((m, l) => (l.date > m ? l.date : m), parsed[0].date);
  return withTx(async (tx) => {
    const acc = await tx.account.findUnique({ where: { id: d.accountId } });
    if (!acc || !acc.isBank || acc.isGroup) throw new AppError("Choose a bank or cash account.");
    if (await tx.bankStatement.findFirst({ where: { accountId: acc.id, reference: d.reference } })) throw new AppError(`Statement ${d.reference} has already been imported for ${acc.name}.`);
    const st = await tx.bankStatement.create({
      data: {
        accountId: acc.id, reference: d.reference, statementDate, openingBalance: opening, closingBalance: closing, createdById: ctx.userId,
        lines: { create: parsed.map((l, i) => ({ lineNo: i + 1, date: l.date, description: l.description, reference: l.reference, amount: l.amount })) },
      },
    });
    await audit(tx, ctx, { action: "CREATE", entity: "BankStatement", entityId: st.id, summary: `Imported statement ${d.reference} for ${acc.code} ${acc.name}: ${parsed.length} line(s), closing ${closing.toFixed(2)}` });
    return st;
  });
}

const lockStatement = (tx: Tx, id: string) => tx.$queryRawUnsafe(`SELECT id FROM "BankStatement" WHERE id = $1 FOR UPDATE`, id);

async function assertOpen(tx: Tx, statementId: string) {
  await lockStatement(tx, statementId);
  const st = await tx.bankStatement.findUniqueOrThrow({ where: { id: statementId } });
  if (st.status !== "OPEN") throw new AppError("This statement is already reconciled.");
  return st;
}

/** Matches unmatched statement lines to unmatched ledger lines of the same amount, preferring a matching reference, then the nearest date. */
export async function autoMatch(ctx: Ctx, statementId: string) {
  requirePerm(ctx, "accounting.bank.reconcile");
  return withTx(async (tx) => {
    const st = await assertOpen(tx, statementId);
    const lines = await tx.bankStatementLine.findMany({ where: { statementId, journalLineId: null }, orderBy: { lineNo: "asc" } });
    let matched = 0;
    for (const l of lines) {
      const from = new Date(l.date.getTime() - MATCH_WINDOW_DAYS * 86_400_000), to = new Date(l.date.getTime() + MATCH_WINDOW_DAYS * 86_400_000);
      const amt = D(l.amount);
      const cands = await tx.journalLine.findMany({
        where: { accountId: st.accountId, posted: true, statementLine: null, date: { gte: from, lte: to }, ...(amt.gt(0) ? { debit: amt } : { credit: amt.abs() }) },
        include: { journal: { select: { number: true, reference: true, sourceNo: true, memo: true } } },
      });
      if (!cands.length) continue;
      const ref = (l.reference ?? "").toLowerCase();
      const score = (c: (typeof cands)[number]) => {
        const text = `${c.journal.reference ?? ""} ${c.journal.sourceNo ?? ""} ${c.journal.memo ?? ""} ${c.journal.number}`.toLowerCase();
        return (ref && text.includes(ref) ? 0 : 1_000_000_000) + Math.abs(c.date.getTime() - l.date.getTime());
      };
      const best = cands.sort((a, b) => score(a) - score(b))[0];
      await tx.bankStatementLine.update({ where: { id: l.id }, data: { journalLineId: best.id, matchedAt: new Date(), matchedById: ctx.userId } });
      matched++;
    }
    await audit(tx, ctx, { action: "MATCH", entity: "BankStatement", entityId: statementId, summary: `Auto-matched ${matched} of ${lines.length} open line(s)` });
    return { matched, remaining: lines.length - matched };
  });
}

export async function matchLine(ctx: Ctx, lineId: string, journalLineId: string) {
  requirePerm(ctx, "accounting.bank.reconcile");
  return withTx(async (tx) => {
    const l = await tx.bankStatementLine.findUniqueOrThrow({ where: { id: lineId } });
    const st = await assertOpen(tx, l.statementId);
    if (l.journalLineId) throw new AppError("This statement line is already matched.");
    const jl = await tx.journalLine.findUniqueOrThrow({ where: { id: journalLineId }, include: { statementLine: true } });
    if (jl.accountId !== st.accountId || !jl.posted) throw new AppError("That ledger line is not on this bank account.");
    if (jl.statementLine) throw new AppError("That ledger line is already matched to another statement line.");
    if (!D(jl.debit).sub(D(jl.credit)).equals(D(l.amount))) throw new AppError(`Amounts differ: statement ${D(l.amount).toFixed(2)}, ledger ${D(jl.debit).sub(D(jl.credit)).toFixed(2)}.`);
    await tx.bankStatementLine.update({ where: { id: lineId }, data: { journalLineId, matchedAt: new Date(), matchedById: ctx.userId } });
    await audit(tx, ctx, { action: "MATCH", entity: "BankStatement", entityId: st.id, summary: `Matched statement line ${l.lineNo} manually` });
  });
}

export async function unmatchLine(ctx: Ctx, lineId: string) {
  requirePerm(ctx, "accounting.bank.reconcile");
  return withTx(async (tx) => {
    const l = await tx.bankStatementLine.findUniqueOrThrow({ where: { id: lineId } });
    await assertOpen(tx, l.statementId);
    await tx.bankStatementLine.update({ where: { id: lineId }, data: { journalLineId: null, matchedAt: null, matchedById: null } });
    await audit(tx, ctx, { action: "UNMATCH", entity: "BankStatement", entityId: l.statementId, summary: `Unmatched statement line ${l.lineNo}` });
  });
}

/** Books an item that appears only on the bank statement (charges, interest, direct debits) and matches it. */
export async function bookStatementLine(ctx: Ctx, lineId: string, raw: unknown) {
  requirePerm(ctx, "accounting.bank.reconcile");
  const d = z.object({ accountId: z.string().max(40).optional(), description: optStr(300) }).parse(raw);
  return withTx(async (tx) => {
    const l = await tx.bankStatementLine.findUniqueOrThrow({ where: { id: lineId } });
    const st = await assertOpen(tx, l.statementId);
    if (l.journalLineId) throw new AppError("This statement line is already matched.");
    const amt = D(l.amount);
    const counter = d.accountId ? { id: d.accountId } : ("BANK_CHARGES" as const);
    const j = await postJournal(tx, ctx, {
      date: l.date, type: "BANK", memo: d.description || l.description, reference: l.reference ?? st.reference,
      source: { type: "BankStatementLine", id: l.id, no: `${st.reference}/${l.lineNo}` },
      lines: [{ account: { id: st.accountId }, debit: amt.gt(0) ? amt : ZERO, credit: amt.lt(0) ? amt.abs() : ZERO, description: l.description }, { account: counter, debit: amt.lt(0) ? amt.abs() : ZERO, credit: amt.gt(0) ? amt : ZERO, description: l.description }],
    });
    const bankLine = await tx.journalLine.findFirstOrThrow({ where: { journalId: j!.id, accountId: st.accountId } });
    await tx.bankStatementLine.update({ where: { id: lineId }, data: { journalLineId: bankLine.id, matchedAt: new Date(), matchedById: ctx.userId } });
    await audit(tx, ctx, { action: "POST", entity: "BankStatement", entityId: st.id, summary: `Booked statement line ${l.lineNo} (${amt.toFixed(2)}) as ${j!.number}` });
    return j;
  });
}

/**
 * Reconciliation proof at the statement date:
 * statement closing = book balance − book items not yet on the bank + bank items not yet in the books.
 * Book items before the account's first imported statement are treated as already cleared.
 */
export async function reconciliation(ctx: Ctx, statementId: string) {
  requirePerm(ctx, "accounting.view");
  const st = await prisma.bankStatement.findUnique({
    where: { id: statementId },
    include: { account: true, lines: { orderBy: { lineNo: "asc" }, include: { journalLine: { include: { journal: { select: { id: true, number: true, memo: true, sourceNo: true, sourceType: true, sourceId: true } } } } } } },
  });
  if (!st) return null;
  const first = await prisma.bankStatementLine.findFirst({ where: { statement: { accountId: st.accountId } }, orderBy: { date: "asc" } });
  const start = first?.date ?? st.statementDate;
  const book = await prisma.journalLine.aggregate({ where: { accountId: st.accountId, posted: true, date: { lte: st.statementDate } }, _sum: { debit: true, credit: true } });
  const bookBalance = D(book._sum.debit).sub(D(book._sum.credit));
  const outstanding = await prisma.journalLine.findMany({
    where: { accountId: st.accountId, posted: true, statementLine: null, date: { gte: start, lte: st.statementDate } },
    orderBy: [{ date: "asc" }], include: { journal: { select: { id: true, number: true, memo: true, sourceNo: true, reference: true } } },
  });
  const uncleared = outstanding.reduce((s, l) => s.add(D(l.debit)).sub(D(l.credit)), ZERO);
  const notBooked = st.lines.filter((l) => !l.journalLineId).reduce((s, l) => s.add(D(l.amount)), ZERO);
  const adjusted = bookBalance.sub(uncleared).add(notBooked);
  const difference = D(st.closingBalance).sub(adjusted);
  return { statement: st, start, bookBalance, outstanding, uncleared, notBooked, adjusted, difference, allMatched: st.lines.every((l) => l.journalLineId) };
}

export async function completeReconciliation(ctx: Ctx, statementId: string) {
  requirePerm(ctx, "accounting.bank.reconcile");
  const r = await reconciliation(ctx, statementId);
  if (!r) throw new AppError("Statement not found.");
  if (!r.allMatched) throw new AppError("Match or book every statement line first.");
  if (!r.difference.isZero()) throw new AppError(`The reconciliation is out by ${r.difference.toFixed(2)}.`);
  return withTx(async (tx) => {
    await assertOpen(tx, statementId);
    await tx.bankStatement.update({ where: { id: statementId }, data: { status: "RECONCILED", reconciledAt: new Date(), reconciledById: ctx.userId } });
    await audit(tx, ctx, { action: "RECONCILE", entity: "BankStatement", entityId: statementId, summary: `Reconciled ${r.statement.account.code} to statement ${r.statement.reference} dated ${fmtDate(r.statement.statementDate)}` });
  });
}

export async function listStatements(ctx: Ctx, accountId?: string) {
  requirePerm(ctx, "accounting.view");
  const rows = await prisma.bankStatement.findMany({
    where: accountId ? { accountId } : {}, orderBy: [{ statementDate: "desc" }], take: 200,
    include: { account: { select: { code: true, name: true } }, _count: { select: { lines: true } }, lines: { where: { journalLineId: null }, select: { id: true } } },
  });
  return rows.map((r) => ({ ...r, unmatched: r.lines.length }));
}

/** Unmatched ledger lines on the account near a statement line, for manual matching. */
export async function matchCandidates(statementLineId: string) {
  const l = await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: statementLineId }, include: { statement: true } });
  const amt = D(l.amount);
  return prisma.journalLine.findMany({
    where: { accountId: l.statement.accountId, posted: true, statementLine: null, ...(amt.gt(0) ? { debit: amt } : { credit: amt.abs() }) },
    orderBy: { date: "desc" }, take: 20, include: { journal: { select: { number: true, memo: true, sourceNo: true } } },
  });
}

export type Reconciliation = NonNullable<Awaited<ReturnType<typeof reconciliation>>>;
export type { Dec };

/**
 * Deletes an open statement (e.g. imported into the wrong account). Items booked
 * from it are reversed; ledger entries it was matched to are untouched.
 */
export async function deleteStatement(ctx: Ctx, statementId: string) {
  requirePerm(ctx, "accounting.bank.reconcile");
  return withTx(async (tx) => {
    const st = await assertOpen(tx, statementId);
    const lines = await tx.bankStatementLine.findMany({ where: { statementId } });
    let reversed = 0;
    for (const l of lines) {
      const j = await tx.journalEntry.findUnique({ where: { sourceType_sourceId_sourceKind: { sourceType: "BankStatementLine", sourceId: l.id, sourceKind: "POST" } }, include: { reversedBy: true } });
      if (j && !j.reversedBy) { await reverseJournal(tx, ctx, j.id, { memo: `Statement ${st.reference} deleted` }); reversed++; }
    }
    await tx.bankStatement.delete({ where: { id: statementId } });
    await audit(tx, ctx, { action: "DELETE", entity: "BankStatement", entityId: statementId, summary: `Deleted open statement ${st.reference} (${lines.length} line(s); ${reversed} booked item(s) reversed)` });
  });
}
