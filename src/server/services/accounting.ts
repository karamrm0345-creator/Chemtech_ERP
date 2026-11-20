/**
 * Accounting: chart of accounts, manual journals, fiscal years / period close
 * and financial statements, all read from the posted general ledger.
 */
import { z } from "zod";
import type { Account, AccountType, Prisma } from "@prisma/client";
import { prisma, withTx, type Tx } from "../db";
import { requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { nextNumber } from "../numbering";
import { AppError } from "../errors";
import { D, ZERO, round2, type Dec } from "@/lib/decimal";
import { fmtDate } from "@/lib/format";
import { optDate, optId, optStr, reqStr, decimalStr } from "@/lib/validation";
import { POSTING_KEYS, type PostingKey } from "../accounting/chart";
import { accountId as postingAccount, assertOpenPeriod, balancedLines, ledgerDate, postJournal, reverseJournal } from "../accounting/ledger";
import { getSettings, lockRow, orderBy, paging, type ListArgs } from "./common";

/** Debit-natured accounts show Dr − Cr as a positive balance; the others Cr − Dr. */
export const debitNatured = (t: AccountType) => t === "ASSET" || t === "EXPENSE";
const natural = (t: AccountType, dr: Dec, cr: Dec) => (debitNatured(t) ? dr.sub(cr) : cr.sub(dr));

// ───────── Chart of accounts ─────────

export const accountSchema = z.object({
  code: z.string().trim().min(1, "Required").max(20).regex(/^[A-Za-z0-9.-]+$/, "Letters, digits, dot and dash only"),
  name: reqStr(120),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
  parentId: optId,
  isGroup: z.coerce.boolean().default(false),
  isBank: z.coerce.boolean().default(false),
  description: optStr(500),
  active: z.coerce.boolean().default(true),
});

async function checkParent(tx: Tx, parentId: string | undefined, type: AccountType, selfId?: string) {
  if (!parentId) return null;
  const p = await tx.account.findUnique({ where: { id: parentId } });
  if (!p) throw new AppError("Parent account not found.");
  if (!p.isGroup) throw new AppError(`${p.code} ${p.name} is not a group account.`);
  if (p.type !== type) throw new AppError(`A ${type.toLowerCase()} account must sit under a ${type.toLowerCase()} group.`);
  for (let cur: Account | null = p; cur; cur = cur.parentId ? await tx.account.findUnique({ where: { id: cur.parentId } }) : null) {
    if (cur.id === selfId) throw new AppError("An account cannot be placed under itself.");
  }
  return p;
}

export async function createAccount(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "accounting.coa.manage");
  const d = accountSchema.parse(raw);
  return withTx(async (tx) => {
    if (await tx.account.findUnique({ where: { code: d.code } })) throw new AppError(`Account code ${d.code} already exists.`);
    await checkParent(tx, d.parentId, d.type);
    if (d.isGroup && d.isBank) throw new AppError("A group account cannot be a bank account.");
    const a = await tx.account.create({ data: { ...d, parentId: d.parentId ?? null } });
    await audit(tx, ctx, { action: "CREATE", entity: "Account", entityId: a.id, summary: `Created account ${a.code} ${a.name}`, after: a });
    return a;
  });
}

export async function updateAccount(ctx: Ctx, id: string, raw: unknown) {
  requirePerm(ctx, "accounting.coa.manage");
  const d = accountSchema.parse(raw);
  return withTx(async (tx) => {
    const before = await tx.account.findUniqueOrThrow({ where: { id }, include: { _count: { select: { lines: true, children: true } } } });
    const used = before._count.lines > 0;
    if (used && (d.type !== before.type || d.isGroup !== before.isGroup)) throw new AppError("Type and group flag cannot change once the account has ledger entries.");
    if (before._count.children > 0 && !d.isGroup) throw new AppError("This account has sub-accounts, so it must stay a group.");
    if (d.code !== before.code && (await tx.account.findUnique({ where: { code: d.code } }))) throw new AppError(`Account code ${d.code} already exists.`);
    await checkParent(tx, d.parentId, d.type, id);
    if (d.isGroup && d.isBank) throw new AppError("A group account cannot be a bank account.");
    if (!d.active && (await tx.accountDefault.count({ where: { accountId: id } }))) throw new AppError("This account is a posting account; map another account before deactivating it.");
    const a = await tx.account.update({ where: { id }, data: { ...d, parentId: d.parentId ?? null } });
    await audit(tx, ctx, { action: "UPDATE", entity: "Account", entityId: id, summary: `Updated account ${a.code} ${a.name}`, before, after: a });
    return a;
  });
}

export async function setPostingAccount(ctx: Ctx, key: string, accountId: string) {
  requirePerm(ctx, "accounting.coa.manage");
  if (!(key in POSTING_KEYS)) throw new AppError("Unknown posting account.");
  return withTx(async (tx) => {
    const a = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    if (a.isGroup || !a.active) throw new AppError("Choose an active, non-group account.");
    if ((key === "CASH" || key === "BANK") && !a.isBank) throw new AppError("Cash and bank posting accounts must be marked as bank / cash accounts.");
    const before = await tx.accountDefault.findUnique({ where: { key } });
    await tx.accountDefault.upsert({ where: { key }, create: { key, accountId }, update: { accountId } });
    await audit(tx, ctx, { action: "UPDATE", entity: "AccountDefault", entityId: key, summary: `Posting account "${POSTING_KEYS[key as PostingKey]}" → ${a.code} ${a.name}`, before, after: { key, accountId } });
  });
}

export async function postingAccounts(ctx: Ctx) {
  requirePerm(ctx, "accounting.view");
  const rows = await prisma.accountDefault.findMany({ include: { account: true } });
  return (Object.keys(POSTING_KEYS) as PostingKey[]).map((key) => ({ key, label: POSTING_KEYS[key], account: rows.find((r) => r.key === key)?.account ?? null }));
}

/** Sum of posted debits and credits per account, optionally within dates and excluding journal types. */
async function sums(where: { from?: Date; to?: Date; before?: Date; excludeTypes?: string[] }) {
  const date: Prisma.DateTimeFilter = {};
  if (where.from) date.gte = where.from;
  if (where.to) date.lte = where.to;
  if (where.before) date.lt = where.before;
  const g = await prisma.journalLine.groupBy({
    by: ["accountId"], _sum: { debit: true, credit: true },
    where: { posted: true, ...(Object.keys(date).length ? { date } : {}), ...(where.excludeTypes ? { journal: { type: { notIn: where.excludeTypes } } } : {}) },
  });
  return new Map(g.map((r) => [r.accountId, { dr: D(r._sum.debit), cr: D(r._sum.credit) }]));
}

export type AccountNode = Account & { depth: number; dr: Dec; cr: Dec; balance: Dec; hasChildren: boolean };

/** Accounts in tree order with group totals rolled up from their sub-accounts. */
function tree(accounts: Account[], s: Map<string, { dr: Dec; cr: Dec }>): AccountNode[] {
  const kids = new Map<string | null, Account[]>();
  for (const a of accounts) kids.set(a.parentId, [...(kids.get(a.parentId) ?? []), a]);
  for (const v of kids.values()) v.sort((a, b) => a.code.localeCompare(b.code));
  const out: AccountNode[] = [];
  const walk = (a: Account, depth: number): { dr: Dec; cr: Dec } => {
    const node = { ...a, depth, dr: ZERO, cr: ZERO, balance: ZERO, hasChildren: (kids.get(a.id) ?? []).length > 0 } as AccountNode;
    out.push(node);
    let dr = s.get(a.id)?.dr ?? ZERO;
    let cr = s.get(a.id)?.cr ?? ZERO;
    for (const c of kids.get(a.id) ?? []) { const t = walk(c, depth + 1); dr = dr.add(t.dr); cr = cr.add(t.cr); }
    node.dr = dr; node.cr = cr; node.balance = natural(a.type, dr, cr);
    return { dr, cr };
  };
  const ids = new Set(accounts.map((a) => a.id));
  for (const root of accounts.filter((a) => !a.parentId || !ids.has(a.parentId)).sort((a, b) => a.code.localeCompare(b.code))) walk(root, 0);
  return out;
}

export async function chartOfAccounts(ctx: Ctx, opts: { includeInactive?: boolean } = {}) {
  requirePerm(ctx, "accounting.view");
  const accounts = await prisma.account.findMany({ where: opts.includeInactive ? {} : { active: true } });
  return tree(accounts, await sums({}));
}

export async function bankAccounts() {
  return prisma.account.findMany({ where: { isBank: true, active: true, isGroup: false }, orderBy: { code: "asc" } });
}

// ───────── Manual journal entries ─────────

const journalLineSchema = z.object({
  accountId: reqStr(40),
  debit: decimalStr.optional().default("0"),
  credit: decimalStr.optional().default("0"),
  partyType: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["CUSTOMER", "SUPPLIER"]).optional()),
  partyId: optId,
  description: optStr(300),
});

export const journalSchema = z.object({
  date: optDate,
  memo: reqStr(500),
  reference: optStr(100),
  type: z.enum(["MANUAL", "OPENING"]).default("MANUAL"),
  lines: z.array(journalLineSchema).min(2, "A journal needs at least two lines"),
});

function checkLines(lines: z.infer<typeof journalLineSchema>[]) {
  lines.forEach((l, i) => {
    const dr = D(l.debit), cr = D(l.credit);
    if (dr.isNeg() || cr.isNeg()) throw new AppError(`Line ${i + 1}: amounts cannot be negative.`);
    if (dr.isZero() === cr.isZero()) throw new AppError(`Line ${i + 1}: enter either a debit or a credit.`);
    if (!!l.partyType !== !!l.partyId) throw new AppError(`Line ${i + 1}: choose both the party type and the party.`);
  });
}

export async function saveJournal(ctx: Ctx, id: string | null, raw: unknown) {
  requirePerm(ctx, "accounting.journal.manage");
  const d = journalSchema.parse(raw);
  checkLines(d.lines);
  const date = ledgerDate(d.date ?? new Date());
  const lines = d.lines.map((l, i) => ({
    lineNo: i + 1, accountId: l.accountId, date, debit: round2(D(l.debit)), credit: round2(D(l.credit)),
    partyType: l.partyType ?? null, partyId: l.partyId ?? null, description: l.description ?? null, posted: false,
  }));
  const totalDebit = lines.reduce((s, l) => s.add(l.debit), ZERO);
  return withTx(async (tx) => {
    const accounts = await tx.account.findMany({ where: { id: { in: lines.map((l) => l.accountId) } } });
    for (const l of lines) {
      const a = accounts.find((x) => x.id === l.accountId);
      if (!a) throw new AppError(`Line ${l.lineNo}: unknown account.`);
      if (a.isGroup || !a.active) throw new AppError(`Line ${l.lineNo}: ${a.code} ${a.name} cannot take postings.`);
    }
    if (id) {
      await lockRow(tx, "JournalEntry", id);
      const j = await tx.journalEntry.findUniqueOrThrow({ where: { id } });
      if (j.status !== "DRAFT" || j.sourceType) throw new AppError("Only draft manual journals can be edited.");
      await tx.journalLine.deleteMany({ where: { journalId: id } });
      const upd = await tx.journalEntry.update({ where: { id }, data: { date, memo: d.memo, reference: d.reference, type: d.type, totalDebit, lines: { create: lines } } });
      await audit(tx, ctx, { action: "UPDATE", entity: "JournalEntry", entityId: id, summary: `Edited draft journal ${j.number}` });
      return upd;
    }
    const number = await nextNumber(tx, "JOURNAL_ENTRY");
    const j = await tx.journalEntry.create({ data: { number, date, type: d.type, memo: d.memo, reference: d.reference, totalDebit, createdById: ctx.userId, lines: { create: lines } } });
    await audit(tx, ctx, { action: "CREATE", entity: "JournalEntry", entityId: j.id, summary: `Prepared journal ${number}: ${d.memo}` });
    return j;
  });
}

/** Posts a draft manual journal. The preparer may not post their own journal. */
export async function postManualJournal(ctx: Ctx, id: string) {
  requirePerm(ctx, "accounting.journal.post");
  return withTx(async (tx) => {
    await lockRow(tx, "JournalEntry", id);
    const j = await tx.journalEntry.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    if (j.status !== "DRAFT" || j.sourceType) throw new AppError(`Cannot post: ${j.number} is ${j.status.toLowerCase()}.`);
    if (j.createdById === ctx.userId) throw new AppError("Separation of duties: you cannot post a journal you prepared.");
    await balancedLines(tx, j.lines.map((l) => ({ account: { id: l.accountId }, debit: D(l.debit), credit: D(l.credit) })), { allowRounding: false });
    await assertOpenPeriod(tx, j.date);
    await tx.journalLine.updateMany({ where: { journalId: id }, data: { posted: true } });
    await tx.journalEntry.update({ where: { id }, data: { status: "POSTED", postedById: ctx.userId, postedAt: new Date() } });
    await audit(tx, ctx, { action: "POST", entity: "JournalEntry", entityId: id, summary: `Posted journal ${j.number} (${j.totalDebit})` });
  });
}

export async function cancelDraftJournal(ctx: Ctx, id: string) {
  requirePerm(ctx, "accounting.journal.manage");
  return withTx(async (tx) => {
    await lockRow(tx, "JournalEntry", id);
    const j = await tx.journalEntry.findUniqueOrThrow({ where: { id } });
    if (j.status !== "DRAFT") throw new AppError("Only draft journals can be cancelled; reverse a posted journal instead.");
    await tx.journalEntry.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, { action: "CANCEL", entity: "JournalEntry", entityId: id, summary: `Cancelled draft journal ${j.number}` });
  });
}

/** Reverses a posted manual journal (documents reverse their own journals). */
export async function reverseManualJournal(ctx: Ctx, id: string, reason: string, date?: Date) {
  requirePerm(ctx, "accounting.journal.post");
  if (!reason?.trim()) throw new AppError("A reversal reason is required.");
  return withTx(async (tx) => {
    const j = await tx.journalEntry.findUniqueOrThrow({ where: { id } });
    if (j.sourceType) throw new AppError(`${j.number} was posted by ${j.sourceNo}; correct it through that document.`);
    const r = await reverseJournal(tx, ctx, id, { date, memo: `Reversal of ${j.number}: ${reason}` });
    await audit(tx, ctx, { action: "REVERSE", entity: "JournalEntry", entityId: id, summary: `Reversed ${j.number} by ${r.number}: ${reason}` });
    return r;
  });
}

export async function listJournals(ctx: Ctx, a: ListArgs & { type?: string; status?: string; from?: Date; to?: Date }) {
  requirePerm(ctx, "accounting.view");
  const where: Prisma.JournalEntryWhereInput = {
    ...(a.type ? { type: a.type } : {}),
    ...(a.status ? { status: a.status as never } : {}),
    ...(a.from || a.to ? { date: { ...(a.from ? { gte: ledgerDate(a.from) } : {}), ...(a.to ? { lte: ledgerDate(a.to) } : {}) } } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { memo: { contains: a.q, mode: "insensitive" } }, { sourceNo: { contains: a.q, mode: "insensitive" } }, { reference: { contains: a.q, mode: "insensitive" } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.journalEntry.findMany({ where, skip, take, orderBy: orderBy(a, ["number", "date", "type", "status", "totalDebit"], { date: "desc" }) }),
    prisma.journalEntry.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getJournal(ctx: Ctx, id: string) {
  requirePerm(ctx, "accounting.view");
  const j = await prisma.journalEntry.findUnique({
    where: { id },
    include: { lines: { orderBy: { lineNo: "asc" }, include: { account: true } }, reversedBy: true, reversalOf: true },
  });
  if (!j) return null;
  const users = await prisma.user.findMany({ where: { id: { in: [j.createdById, j.postedById].filter(Boolean) as string[] } }, select: { id: true, name: true } });
  return { ...j, parties: await partyNames(j.lines), createdBy: users.find((u) => u.id === j.createdById)?.name, postedBy: users.find((u) => u.id === j.postedById)?.name };
}

async function partyNames(lines: { partyType: string | null; partyId: string | null }[]) {
  const cus = lines.filter((l) => l.partyType === "CUSTOMER").map((l) => l.partyId!);
  const sup = lines.filter((l) => l.partyType === "SUPPLIER").map((l) => l.partyId!);
  const [c, s] = await Promise.all([
    cus.length ? prisma.customer.findMany({ where: { id: { in: cus } }, select: { id: true, legalName: true } }) : [],
    sup.length ? prisma.supplier.findMany({ where: { id: { in: sup } }, select: { id: true, legalName: true } }) : [],
  ]);
  return new Map([...c, ...s].map((p) => [p.id, p.legalName]));
}

/** Ledger journals posted for a document (e.g. an invoice) and their reversals. */
export async function journalsForSource(ctx: Ctx, sourceType: string, sourceId: string) {
  if (!ctx.permissions.has("accounting.view")) return [];
  return prisma.journalEntry.findMany({
    where: { sourceType, sourceId }, orderBy: { createdAt: "asc" },
    include: { lines: { orderBy: { lineNo: "asc" }, include: { account: { select: { code: true, name: true } } } } },
  });
}

// ───────── Fiscal years and period close ─────────

export const fiscalYearSchema = z.object({ name: reqStr(40), startDate: optDate, endDate: optDate });

export async function listFiscalYears(ctx: Ctx) {
  requirePerm(ctx, "accounting.view");
  const [years, settings] = await Promise.all([prisma.fiscalYear.findMany({ orderBy: { startDate: "desc" } }), getSettings(prisma as unknown as Tx)]);
  return { years, booksLockedUntil: settings.booksLockedUntil };
}

export async function createFiscalYear(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "accounting.period.close");
  const d = fiscalYearSchema.parse(raw);
  if (!d.startDate || !d.endDate) throw new AppError("Enter the start and end dates.");
  const start = ledgerDate(d.startDate), end = ledgerDate(d.endDate);
  if (end <= start) throw new AppError("The end date must be after the start date.");
  if ((end.getTime() - start.getTime()) / 86_400_000 > 550) throw new AppError("A fiscal year cannot be longer than 18 months.");
  return withTx(async (tx) => {
    const overlap = await tx.fiscalYear.findFirst({ where: { startDate: { lte: end }, endDate: { gte: start } } });
    if (overlap) throw new AppError(`Overlaps fiscal year ${overlap.name}.`);
    if (await tx.fiscalYear.findUnique({ where: { name: d.name } })) throw new AppError(`Fiscal year ${d.name} already exists.`);
    const fy = await tx.fiscalYear.create({ data: { name: d.name, startDate: start, endDate: end } });
    await audit(tx, ctx, { action: "CREATE", entity: "FiscalYear", entityId: fy.id, summary: `Created fiscal year ${fy.name} (${fmtDate(start)} – ${fmtDate(end)})` });
    return fy;
  });
}

/**
 * Closes a fiscal year: posts a closing journal on the last day that zeroes
 * every income and expense account into retained earnings, then locks the
 * year. Draft journals in the year must be posted or cancelled first.
 */
export async function closeFiscalYear(ctx: Ctx, id: string) {
  requirePerm(ctx, "accounting.period.close");
  return withTx(async (tx) => {
    await lockRow(tx, "FiscalYear", id);
    const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id } });
    if (fy.status === "CLOSED") throw new AppError(`Fiscal year ${fy.name} is already closed.`);
    const earlierOpen = await tx.fiscalYear.findFirst({ where: { endDate: { lt: fy.startDate }, status: "OPEN" } });
    if (earlierOpen) throw new AppError(`Close fiscal year ${earlierOpen.name} first.`);
    const drafts = await tx.journalEntry.count({ where: { status: "DRAFT", date: { gte: fy.startDate, lte: fy.endDate } } });
    if (drafts) throw new AppError(`${drafts} draft journal(s) are dated in ${fy.name}. Post or cancel them first.`);
    const g = await tx.journalLine.groupBy({
      by: ["accountId"], _sum: { debit: true, credit: true },
      where: { posted: true, date: { gte: fy.startDate, lte: fy.endDate }, account: { type: { in: ["INCOME", "EXPENSE"] } } },
    });
    const lines = g
      .map((r) => ({ id: r.accountId, net: D(r._sum.debit).sub(D(r._sum.credit)) }))
      .filter((r) => !r.net.isZero())
      .map((r) => (r.net.isPos() ? { account: { id: r.id }, credit: r.net } : { account: { id: r.id }, debit: r.net.neg() }));
    const profit = lines.reduce((s, l) => s.add(D(l.credit)).sub(D(l.debit)), ZERO).neg(); // income − expense
    let journalId: string | null = null;
    if (lines.length) {
      const j = await postJournal(tx, ctx, {
        date: fy.endDate, type: "CLOSING", memo: `Closing entry for fiscal year ${fy.name}`,
        source: { type: "FiscalYear", id: fy.id, no: fy.name, kind: `CLOSE-${Date.now()}` },
        lines: [...lines, profit.isNeg() ? { account: "RETAINED_EARNINGS" as const, debit: profit.neg() } : { account: "RETAINED_EARNINGS" as const, credit: profit }],
      }, { ignoreLock: true });
      journalId = j?.id ?? null;
    }
    await tx.fiscalYear.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), closedById: ctx.userId, closingJournalId: journalId } });
    const s = await getSettings(tx);
    if (!s.booksLockedUntil || s.booksLockedUntil < fy.endDate) await tx.companySettings.update({ where: { id: 1 }, data: { booksLockedUntil: fy.endDate } });
    await audit(tx, ctx, { action: "CLOSE", entity: "FiscalYear", entityId: id, summary: `Closed fiscal year ${fy.name}; net ${profit.isNeg() ? "loss" : "profit"} ${profit.abs().toFixed(2)} to retained earnings` });
    return { profit };
  });
}

/** Reopens the most recently closed fiscal year by reversing its closing entry. */
export async function reopenFiscalYear(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "accounting.period.close");
  if (!reason?.trim()) throw new AppError("A reason is required to reopen a fiscal year.");
  return withTx(async (tx) => {
    await lockRow(tx, "FiscalYear", id);
    const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id } });
    if (fy.status !== "CLOSED") throw new AppError(`Fiscal year ${fy.name} is not closed.`);
    const later = await tx.fiscalYear.findFirst({ where: { startDate: { gt: fy.endDate }, status: "CLOSED" } });
    if (later) throw new AppError(`Reopen fiscal year ${later.name} first.`);
    await tx.fiscalYear.update({ where: { id }, data: { status: "OPEN", closedAt: null, closedById: null, closingJournalId: null } });
    if (fy.closingJournalId) await reverseJournal(tx, ctx, fy.closingJournalId, { date: fy.endDate, memo: `Reopened ${fy.name}: ${reason}`, ignoreLock: true });
    const s = await getSettings(tx);
    if (s.booksLockedUntil && s.booksLockedUntil >= fy.startDate) {
      await tx.companySettings.update({ where: { id: 1 }, data: { booksLockedUntil: new Date(fy.startDate.getTime() - 86_400_000) } });
    }
    await audit(tx, ctx, { action: "REOPEN", entity: "FiscalYear", entityId: id, summary: `Reopened fiscal year ${fy.name}: ${reason}` });
  });
}

/** Sets (or clears) the books lock date: nothing may be posted on or before it. */
export async function setBooksLock(ctx: Ctx, date: Date | null) {
  requirePerm(ctx, "accounting.period.close");
  return withTx(async (tx) => {
    const s = await getSettings(tx);
    const d = date ? ledgerDate(date) : null;
    const closed = await tx.fiscalYear.findFirst({ where: { status: "CLOSED" }, orderBy: { endDate: "desc" } });
    if (closed && (!d || d < closed.endDate)) throw new AppError(`Fiscal year ${closed.name} is closed; the lock date cannot be before ${fmtDate(closed.endDate)}.`);
    await tx.companySettings.update({ where: { id: 1 }, data: { booksLockedUntil: d } });
    await audit(tx, ctx, { action: "UPDATE", entity: "CompanySettings", entityId: "1", summary: d ? `Books locked up to ${fmtDate(d)}` : "Books lock date cleared", before: { booksLockedUntil: s.booksLockedUntil }, after: { booksLockedUntil: d } });
  });
}

// ───────── Financial statements ─────────

/**
 * Opening, period movement and closing per account. Openings are cumulative, so
 * income and expense start the year at zero once the previous year is closed.
 */
export async function trialBalance(ctx: Ctx, opts: { from: Date; to: Date }) {
  requirePerm(ctx, "accounting.view");
  const from = ledgerDate(opts.from), to = ledgerDate(opts.to);
  const [accounts, before, period] = await Promise.all([prisma.account.findMany(), sums({ before: from }), sums({ from, to })]);
  const rows = accounts.filter((a) => !a.isGroup).map((a) => {
    const ob = before.get(a.id) ?? { dr: ZERO, cr: ZERO };
    const mv = period.get(a.id) ?? { dr: ZERO, cr: ZERO };
    const opening = ob.dr.sub(ob.cr);
    const closing = opening.add(mv.dr).sub(mv.cr);
    return {
      id: a.id, code: a.code, name: a.name, type: a.type,
      openingDr: opening.isPos() ? opening : ZERO, openingCr: opening.isNeg() ? opening.neg() : ZERO,
      debit: mv.dr, credit: mv.cr,
      closingDr: closing.isPos() ? closing : ZERO, closingCr: closing.isNeg() ? closing.neg() : ZERO,
    };
  }).filter((r) => !(r.openingDr.isZero() && r.openingCr.isZero() && r.debit.isZero() && r.credit.isZero())).sort((a, b) => a.code.localeCompare(b.code));
  const total = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s.add(r[k] as Dec), ZERO);
  return {
    rows,
    totals: { openingDr: total("openingDr"), openingCr: total("openingCr"), debit: total("debit"), credit: total("credit"), closingDr: total("closingDr"), closingCr: total("closingCr") },
  };
}

/** Income and expense for a period. Year-closing entries are excluded so closed years still report. */
export async function profitAndLoss(ctx: Ctx, opts: { from: Date; to: Date }) {
  requirePerm(ctx, "accounting.view");
  const s = await sums({ from: ledgerDate(opts.from), to: ledgerDate(opts.to), excludeTypes: ["CLOSING"] });
  const accounts = await prisma.account.findMany({ where: { type: { in: ["INCOME", "EXPENSE"] } } });
  const nodes = tree(accounts, s);
  const income = nodes.filter((n) => n.type === "INCOME" && n.depth === 0).reduce((t, n) => t.add(n.balance), ZERO);
  const expense = nodes.filter((n) => n.type === "EXPENSE" && n.depth === 0).reduce((t, n) => t.add(n.balance), ZERO);
  return { nodes, income, expense, netProfit: income.sub(expense) };
}

/** Assets, liabilities and equity at a date; profit not yet closed to retained earnings is shown in equity. */
export async function balanceSheet(ctx: Ctx, opts: { asOf: Date }) {
  requirePerm(ctx, "accounting.view");
  const s = await sums({ to: ledgerDate(opts.asOf) });
  const accounts = await prisma.account.findMany();
  const bs = tree(accounts.filter((a) => ["ASSET", "LIABILITY", "EQUITY"].includes(a.type)), s);
  const unclosedProfit = accounts.filter((a) => a.type === "INCOME" || a.type === "EXPENSE")
    .reduce((t, a) => { const v = s.get(a.id); return v ? t.add(v.cr).sub(v.dr) : t; }, ZERO);
  const top = (t: AccountType) => bs.filter((n) => n.type === t && n.depth === 0).reduce((x, n) => x.add(n.balance), ZERO);
  const assets = top("ASSET"), liabilities = top("LIABILITY"), equity = top("EQUITY");
  return { nodes: bs, assets, liabilities, equity, unclosedProfit, liabilitiesAndEquity: liabilities.add(equity).add(unclosedProfit), difference: assets.sub(liabilities.add(equity).add(unclosedProfit)) };
}

/** Account statement with opening balance and running balance. */
export async function generalLedger(ctx: Ctx, opts: { accountId?: string; partyType?: string; partyId?: string; from: Date; to: Date; limit?: number }) {
  requirePerm(ctx, "accounting.view");
  const from = ledgerDate(opts.from), to = ledgerDate(opts.to);
  const base: Prisma.JournalLineWhereInput = {
    posted: true,
    ...(opts.accountId ? { accountId: opts.accountId } : {}),
    ...(opts.partyType && opts.partyId ? { partyType: opts.partyType, partyId: opts.partyId } : {}),
  };
  const account = opts.accountId ? await prisma.account.findUnique({ where: { id: opts.accountId } }) : null;
  const ob = await prisma.journalLine.aggregate({ where: { ...base, date: { lt: from } }, _sum: { debit: true, credit: true } });
  const lines = await prisma.journalLine.findMany({
    where: { ...base, date: { gte: from, lte: to } }, take: Math.min(opts.limit ?? 2000, 5000),
    orderBy: [{ date: "asc" }, { journal: { number: "asc" } }, { lineNo: "asc" }],
    include: { account: { select: { code: true, name: true } }, journal: { select: { id: true, number: true, type: true, memo: true, sourceType: true, sourceId: true, sourceNo: true } } },
  });
  const opening = D(ob._sum.debit).sub(D(ob._sum.credit));
  let run = opening;
  const parties = await partyNames(lines);
  const rows = lines.map((l) => { run = run.add(D(l.debit)).sub(D(l.credit)); return { ...l, party: l.partyId ? parties.get(l.partyId) ?? null : null, balance: run }; });
  return {
    account, opening, closing: run, rows,
    totals: { debit: rows.reduce((s, r) => s.add(D(r.debit)), ZERO), credit: rows.reduce((s, r) => s.add(D(r.credit)), ZERO) },
  };
}

/** Net profit for a period (posted ledger, excluding closing entries). Used by the dashboard. */
export async function netProfit(from: Date, to: Date) {
  const g = await prisma.journalLine.groupBy({
    by: ["accountId"], _sum: { debit: true, credit: true },
    where: { posted: true, date: { gte: ledgerDate(from), lte: ledgerDate(to) }, journal: { type: { not: "CLOSING" } }, account: { type: { in: ["INCOME", "EXPENSE"] } } },
  });
  return g.reduce((s, r) => s.add(D(r._sum.credit)).sub(D(r._sum.debit)), ZERO);
}

export { postingAccount };

/** Default statement period: start of the fiscal year containing today, to today (yyyy-mm-dd, business time). */
export async function currentPeriod() {
  const today = ledgerDate(new Date());
  const fy = await prisma.fiscalYear.findFirst({ where: { startDate: { lte: today }, endDate: { gte: today } } });
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fy ? iso(fy.startDate) : `${today.getUTCFullYear()}-01-01`, to: iso(today) };
}
