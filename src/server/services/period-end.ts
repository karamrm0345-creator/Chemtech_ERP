/**
 * Period-end tasks and the cash flow statement.
 *
 * Revaluation restates open foreign-currency receivables, payables and
 * unapplied credits at the period-end rate (unrealised exchange difference)
 * and reverses itself the next day, so realised differences are still
 * measured from the original rates when the items settle.
 */
import { z } from "zod";
import { prisma, withTx } from "../db";
import { requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { AppError } from "../errors";
import { optDate } from "@/lib/validation";
import { D, ZERO, round2, type Dec } from "@/lib/decimal";
import { fmtDate } from "@/lib/format";
import { ledgerDate, postJournal, reverseJournal, type PostingLine } from "../accounting/ledger";
import { getSettings } from "./common";
import type { Tx } from "../db";

export const revaluationSchema = z.object({ date: optDate, rates: z.record(z.string(), z.string()).default({}) });

/** Open foreign-currency items as of a date, with their booked rate, for revaluation. */
async function foreignItems(tx: Tx, base: string, asOf: Date) {
  const openInv = { status: { in: ["POSTED", "PARTIALLY_PAID"] as ("POSTED" | "PARTIALLY_PAID")[] }, currency: { not: base }, date: { lte: new Date(asOf.getTime() + 86_399_999) } };
  const [si, pi, cp, sp, cn, dn] = await Promise.all([
    tx.salesInvoice.findMany({ where: openInv }),
    tx.purchaseInvoice.findMany({ where: openInv }),
    tx.customerPayment.findMany({ where: { currency: { not: base } } }),
    tx.supplierPayment.findMany({ where: { currency: { not: base } } }),
    tx.creditNote.findMany({ where: { status: "POSTED", currency: { not: base } } }),
    tx.debitNote.findMany({ where: { status: "POSTED", currency: { not: base } } }),
  ]);
  type Item = { side: "AR" | "AP"; partyType: "CUSTOMER" | "SUPPLIER"; partyId: string; currency: string; open: Dec; rate: Dec; sign: 1 | -1; label: string };
  const out: Item[] = [];
  for (const i of si) out.push({ side: "AR", partyType: "CUSTOMER", partyId: i.customerId, currency: i.currency, open: D(i.total).sub(D(i.paidAmount)), rate: D(i.exchangeRate), sign: 1, label: i.number });
  for (const i of pi) out.push({ side: "AP", partyType: "SUPPLIER", partyId: i.supplierId, currency: i.currency, open: D(i.total).sub(D(i.paidAmount)), rate: D(i.exchangeRate), sign: 1, label: i.number });
  for (const p of cp) out.push({ side: "AR", partyType: "CUSTOMER", partyId: p.customerId, currency: p.currency, open: D(p.amount).sub(D(p.allocatedAmount)), rate: D(p.exchangeRate), sign: -1, label: p.number });
  for (const n of cn) out.push({ side: "AR", partyType: "CUSTOMER", partyId: n.customerId, currency: n.currency, open: D(n.total).sub(D(n.allocatedAmount)), rate: D(n.exchangeRate), sign: -1, label: n.number });
  for (const p of sp) out.push({ side: "AP", partyType: "SUPPLIER", partyId: p.supplierId, currency: p.currency, open: D(p.amount).sub(D(p.allocatedAmount)), rate: D(p.exchangeRate), sign: -1, label: p.number });
  for (const n of dn) out.push({ side: "AP", partyType: "SUPPLIER", partyId: n.supplierId, currency: n.currency, open: D(n.total).sub(D(n.allocatedAmount)), rate: D(n.exchangeRate), sign: -1, label: n.number });
  return out.filter((x) => x.open.gt(0));
}

/** Preview of the revaluation (no posting). */
export async function revaluationPreview(ctx: Ctx, date: Date, rates: Record<string, string> = {}) {
  requirePerm(ctx, "accounting.view");
  const asOf = ledgerDate(date);
  const s = await getSettings(prisma as unknown as Tx);
  const items = await foreignItems(prisma as unknown as Tx, s.baseCurrency, asOf);
  const table = new Map((await prisma.currency.findMany()).map((c) => [c.code, D(c.rateToBase)]));
  const rows = items.map((x) => {
    const rate = rates[x.currency] ? D(rates[x.currency]) : table.get(x.currency) ?? x.rate;
    // Receivable (sign 1) up = gain; customer credit (sign −1) up = loss. Payables the other way round.
    const delta = round2(x.open.mul(rate)).sub(round2(x.open.mul(x.rate))).mul(x.sign);
    const gain = x.side === "AR" ? delta : delta.neg();
    return { ...x, newRate: rate, delta, gain };
  }).filter((r) => !r.delta.isZero());
  return { asOf, rows, total: rows.reduce((t, r) => t.add(r.gain), ZERO) };
}

/** Posts the period-end revaluation and its reversal on the next day. */
export async function postRevaluation(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "accounting.journal.post");
  const d = revaluationSchema.parse(raw);
  const asOf = ledgerDate(d.date ?? new Date());
  const preview = await revaluationPreview(ctx, asOf, d.rates);
  if (!preview.rows.length) throw new AppError(`No open foreign-currency balances need revaluing at ${fmtDate(asOf)}.`);
  return withTx(async (tx) => {
    const lines: PostingLine[] = [];
    for (const r of preview.rows) {
      // delta is the change in the party's balance in its natural direction (receivable / payable).
      const partyLine: PostingLine = r.side === "AR"
        ? { account: "AR", debit: r.delta, partyType: "CUSTOMER", partyId: r.partyId, description: `${r.label} ${r.currency} ${r.open.toFixed(2)} @ ${r.newRate}` }
        : { account: "AP", credit: r.delta, partyType: "SUPPLIER", partyId: r.partyId, description: `${r.label} ${r.currency} ${r.open.toFixed(2)} @ ${r.newRate}` };
      lines.push(partyLine, { account: "UNREALISED_FX", credit: r.gain, description: r.label });
    }
    const iso = asOf.toISOString().slice(0, 10);
    const j = await postJournal(tx, ctx, { date: asOf, type: "REVALUATION", memo: `Foreign-currency revaluation at ${fmtDate(asOf)}`, source: { type: "Revaluation", id: iso, no: `FX-${iso}` }, lines });
    const rev = await reverseJournal(tx, ctx, j!.id, { date: new Date(asOf.getTime() + 86_400_000), memo: `Automatic reversal of revaluation at ${fmtDate(asOf)}` });
    await audit(tx, ctx, { action: "POST", entity: "Revaluation", entityId: j!.id, summary: `Revalued ${preview.rows.length} foreign-currency item(s) at ${fmtDate(asOf)}: net ${preview.total.gt(0) ? "gain" : "loss"} ${preview.total.abs().toFixed(2)} (reversed by ${rev.number})` });
    return { journalId: j!.id, reversalId: rev.id, total: preview.total };
  });
}

// ───────── Cash flow statement (direct method) ─────────

type Section = "OPERATING" | "INVESTING" | "FINANCING";

/**
 * Cash flow from the ledger: every movement on a bank / cash account is
 * attributed to the other accounts in its journal, so each receipt or payment
 * lands under the activity of what it paid for. Transfers between bank
 * accounts cancel out.
 */
export async function cashFlow(ctx: Ctx, opts: { from: Date; to: Date }) {
  requirePerm(ctx, "accounting.view");
  const from = ledgerDate(opts.from), to = ledgerDate(opts.to);
  const cash = await prisma.account.findMany({ where: { isBank: true, isGroup: false } });
  const cashIds = new Set(cash.map((a) => a.id));
  const keys = new Map((await prisma.accountDefault.findMany()).map((d) => [d.accountId, d.key]));
  const sumBefore = await prisma.journalLine.aggregate({ where: { posted: true, accountId: { in: [...cashIds] }, date: { lt: from } }, _sum: { debit: true, credit: true } });
  const opening = D(sumBefore._sum.debit).sub(D(sumBefore._sum.credit));
  const journals = await prisma.journalEntry.findMany({
    where: { status: "POSTED", lines: { some: { posted: true, accountId: { in: [...cashIds] }, date: { gte: from, lte: to } } } },
    include: { lines: { include: { account: true } } },
  });
  const rows = new Map<string, { section: Section; label: string; amount: Dec }>();
  const add = (section: Section, label: string, amount: Dec) => {
    const k = `${section}|${label}`;
    rows.set(k, { section, label, amount: (rows.get(k)?.amount ?? ZERO).add(amount) });
  };
  let net = ZERO;
  for (const j of journals) {
    const cashDelta = j.lines.filter((l) => cashIds.has(l.accountId)).reduce((s, l) => s.add(D(l.debit)).sub(D(l.credit)), ZERO);
    if (cashDelta.isZero()) continue;
    net = net.add(cashDelta);
    for (const l of j.lines.filter((x) => !cashIds.has(x.accountId))) {
      const effect = D(l.credit).sub(D(l.debit)); // the cash this line explains
      if (effect.isZero()) continue;
      const key = keys.get(l.accountId);
      const cat = l.account.cashFlowCategory as Section | null;
      if (key === "AR") add("OPERATING", "Receipts from customers (net of refunds)", effect);
      else if (key === "AP") add("OPERATING", "Payments to suppliers (net of refunds)", effect);
      else if (key === "WHT_PAYABLE" || key === "TAX_INPUT" || key === "TAX_OUTPUT") add("OPERATING", "Taxes (paid, received or withheld)", effect);
      else if (cat === "INVESTING" || cat === "FINANCING") add(cat, l.account.name, effect);
      else if (l.account.type === "INCOME" || l.account.type === "EXPENSE") add("OPERATING", `${l.account.type === "INCOME" ? "Other income" : "Expenses"}: ${l.account.name}`, effect);
      else if (l.account.type === "EQUITY") add("FINANCING", l.account.name, effect);
      else add("OPERATING", `Other: ${l.account.name}`, effect);
    }
  }
  const list = [...rows.values()].filter((r) => !r.amount.isZero()).sort((a, b) => a.label.localeCompare(b.label));
  const total = (s: Section) => list.filter((r) => r.section === s).reduce((t, r) => t.add(r.amount), ZERO);
  const closingSum = await prisma.journalLine.aggregate({ where: { posted: true, accountId: { in: [...cashIds] }, date: { lte: to } }, _sum: { debit: true, credit: true } });
  const closing = D(closingSum._sum.debit).sub(D(closingSum._sum.credit));
  return {
    from, to, opening, closing, net, rows: list,
    totals: { OPERATING: total("OPERATING"), INVESTING: total("INVESTING"), FINANCING: total("FINANCING") },
    difference: closing.sub(opening).sub(net),
  };
}
