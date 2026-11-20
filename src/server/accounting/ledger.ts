/**
 * General-ledger posting engine. Every business event that changes the books
 * goes through postJournal: lines are rounded to 2 dp in base currency, must
 * balance, may only hit active non-group accounts, and are refused in closed
 * periods. Posted journals are never edited; reverseJournal writes the mirror.
 */
import type { Ctx } from "../context";
import type { Tx } from "../db";
import { AppError } from "../errors";
import { nextNumber } from "../numbering";
import { getSettings } from "../services/common";
import { D, ZERO, round2, type Dec } from "@/lib/decimal";
import { fmtDate, toDateInput } from "@/lib/format";
import { POSTING_KEYS, type PostingKey } from "./chart";

export type AccountRef = PostingKey | { id: string };

export interface PostingLine {
  account: AccountRef;
  debit?: Dec;
  credit?: Dec;
  partyType?: "CUSTOMER" | "SUPPLIER";
  partyId?: string;
  description?: string;
  costCenterId?: string | null;
}

export interface JournalInput {
  date: Date;
  type: string;
  memo?: string | null;
  reference?: string | null;
  source?: { type: string; id: string; no: string; kind?: string };
  lines: PostingLine[];
}

/** Largest imbalance from per-line currency rounding that is booked to the rounding account. */
const ROUNDING_TOLERANCE = D("0.05");

/** The business (Asia/Qatar) calendar date of a timestamp, as a UTC-midnight Date for @db.Date columns. */
export function ledgerDate(d: Date | string = new Date()): Date {
  return new Date(`${toDateInput(d)}T00:00:00.000Z`);
}

export async function accountId(tx: Tx, ref: AccountRef): Promise<string> {
  if (typeof ref !== "string") return ref.id;
  const row = await tx.accountDefault.findUnique({ where: { key: ref } });
  if (!row) throw new AppError(`No account is mapped for "${POSTING_KEYS[ref]}". Set it under Accounting → Chart of accounts → Posting accounts.`);
  return row.accountId;
}

/** Throws unless the date is in an open fiscal year after the books lock date. Creates the calendar fiscal year on first use. */
export async function assertOpenPeriod(tx: Tx, date: Date, { ignoreLock = false } = {}) {
  const s = await getSettings(tx);
  if (!ignoreLock && s.booksLockedUntil && date <= s.booksLockedUntil) {
    throw new AppError(`The books are closed up to ${fmtDate(s.booksLockedUntil)}. Use a later date or ask finance to reopen the period.`);
  }
  const fy = await tx.fiscalYear.findFirst({ where: { startDate: { lte: date }, endDate: { gte: date } } });
  if (fy) {
    if (fy.status === "CLOSED") throw new AppError(`Fiscal year ${fy.name} is closed. Use a date in an open fiscal year.`);
    return fy;
  }
  const y = date.getUTCFullYear();
  const start = new Date(Date.UTC(y, 0, 1));
  const end = new Date(Date.UTC(y, 11, 31));
  const overlap = await tx.fiscalYear.findFirst({ where: { startDate: { lte: end }, endDate: { gte: start } } });
  if (overlap) throw new AppError(`No fiscal year covers ${fmtDate(date)}. Create one under Accounting → Fiscal years.`);
  return tx.fiscalYear.upsert({ where: { name: String(y) }, create: { name: String(y), startDate: start, endDate: end }, update: {} });
}

async function resolveLines(tx: Tx, lines: PostingLine[]) {
  const out: { accountId: string; debit: Dec; credit: Dec; partyType?: string; partyId?: string; description?: string; costCenterId?: string | null }[] = [];
  for (const l of lines) {
    let dr = round2(D(l.debit));
    let cr = round2(D(l.credit));
    if (dr.lt(0)) [dr, cr] = [ZERO, cr.add(dr.neg())];
    if (cr.lt(0)) [dr, cr] = [dr.add(cr.neg()), ZERO];
    if (dr.isZero() && cr.isZero()) continue;
    out.push({ accountId: await accountId(tx, l.account), debit: dr, credit: cr, partyType: l.partyType, partyId: l.partyId, description: l.description, costCenterId: l.costCenterId ?? null });
  }
  const ids = [...new Set(out.map((l) => l.accountId))];
  const accounts = await tx.account.findMany({ where: { id: { in: ids } } });
  for (const id of ids) {
    const a = accounts.find((x) => x.id === id);
    if (!a) throw new AppError("Unknown account in journal.");
    if (a.isGroup) throw new AppError(`${a.code} ${a.name} is a group account; post to one of its sub-accounts.`);
    if (!a.active) throw new AppError(`${a.code} ${a.name} is inactive.`);
  }
  return out;
}

/** Validates and balances lines; returns them with any rounding line added. */
export async function balancedLines(tx: Tx, lines: PostingLine[], { allowRounding = true } = {}) {
  const out = await resolveLines(tx, lines);
  const dr = out.reduce((s, l) => s.add(l.debit), ZERO);
  const cr = out.reduce((s, l) => s.add(l.credit), ZERO);
  const diff = dr.sub(cr);
  if (!diff.isZero()) {
    if (!allowRounding || diff.abs().gt(ROUNDING_TOLERANCE)) {
      throw new AppError(`Journal does not balance: debits ${dr.toFixed(2)} vs credits ${cr.toFixed(2)}.`);
    }
    const acc = await accountId(tx, "ROUNDING");
    out.push({ accountId: acc, debit: diff.lt(0) ? diff.neg() : ZERO, credit: diff.gt(0) ? diff : ZERO, description: "Rounding" });
  }
  return { lines: out, total: dr.gt(cr) ? dr : cr };
}

/**
 * Posts a journal immediately. Returns null when every line is zero (nothing to book).
 * `ignoreLock` is only for fiscal-year closing entries, which are dated inside a locked period.
 */
export async function postJournal(tx: Tx, ctx: Ctx, j: JournalInput, { ignoreLock = false } = {}) {
  const date = ledgerDate(j.date);
  const { lines, total } = await balancedLines(tx, j.lines);
  if (!lines.length) return null;
  await assertOpenPeriod(tx, date, { ignoreLock });
  if (j.source) {
    const kind = j.source.kind ?? "POST";
    const dup = await tx.journalEntry.findUnique({ where: { sourceType_sourceId_sourceKind: { sourceType: j.source.type, sourceId: j.source.id, sourceKind: kind } } });
    if (dup) throw new AppError(`${j.source.no} has already been posted to the ledger.`);
  }
  const number = await nextNumber(tx, "JOURNAL_ENTRY");
  return tx.journalEntry.create({
    data: {
      number, date, type: j.type, status: "POSTED", memo: j.memo ?? null, reference: j.reference ?? null,
      sourceType: j.source?.type, sourceId: j.source?.id, sourceNo: j.source?.no, sourceKind: j.source ? j.source.kind ?? "POST" : null,
      totalDebit: total, createdById: ctx.userId, postedById: ctx.userId, postedAt: new Date(),
      lines: { create: lines.map((l, i) => ({ ...l, lineNo: i + 1, date, posted: true })) },
    },
  });
}

/** Writes the mirror image of a posted journal, dated `date` (default today). */
export async function reverseJournal(tx: Tx, ctx: Ctx, journalId: string, opts: { date?: Date; memo?: string; ignoreLock?: boolean } = {}) {
  await tx.$queryRawUnsafe(`SELECT id FROM "JournalEntry" WHERE id = $1 FOR UPDATE`, journalId);
  const j = await tx.journalEntry.findUniqueOrThrow({ where: { id: journalId }, include: { lines: { orderBy: { lineNo: "asc" } }, reversedBy: true } });
  if (j.status !== "POSTED") throw new AppError(`Only posted journals can be reversed (${j.number} is ${j.status.toLowerCase()}).`);
  if (j.reversedBy) throw new AppError(`${j.number} was already reversed by ${j.reversedBy.number}.`);
  if (j.reversalOfId) throw new AppError(`${j.number} is itself a reversal; post a new journal instead.`);
  const date = ledgerDate(opts.date ?? new Date());
  await assertOpenPeriod(tx, date, { ignoreLock: opts.ignoreLock });
  const number = await nextNumber(tx, "JOURNAL_ENTRY");
  return tx.journalEntry.create({
    data: {
      number, date, type: j.type, status: "POSTED", memo: opts.memo ?? `Reversal of ${j.number}`, reference: j.reference,
      sourceType: j.sourceType, sourceId: j.sourceId, sourceNo: j.sourceNo, sourceKind: j.sourceKind ? `${j.sourceKind}-REVERSE` : null,
      reversalOfId: j.id, totalDebit: j.totalDebit, createdById: ctx.userId, postedById: ctx.userId, postedAt: new Date(),
      lines: {
        create: j.lines.map((l) => ({
          lineNo: l.lineNo, accountId: l.accountId, date, debit: l.credit, credit: l.debit, partyType: l.partyType, partyId: l.partyId,
          description: l.description, costCenterId: l.costCenterId, posted: true,
        })),
      },
    },
  });
}

/** Reverses the posting journal of a source document, if it has one. */
export async function reverseSourceJournal(tx: Tx, ctx: Ctx, sourceType: string, sourceId: string, memo?: string) {
  const j = await tx.journalEntry.findUnique({ where: { sourceType_sourceId_sourceKind: { sourceType, sourceId, sourceKind: "POST" } } });
  return j ? reverseJournal(tx, ctx, j.id, { memo }) : null;
}
