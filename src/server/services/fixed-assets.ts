/**
 * Fixed assets: register, capitalisation, monthly straight-line depreciation
 * and disposal. Every step posts its journal; depreciation is recorded per
 * asset and month so it can never be charged twice.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, withTx, type Tx } from "../db";
import { requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { nextNumber } from "../numbering";
import { AppError } from "../errors";
import { nonNegDecimal, optDate, optId, optStr, posDecimal, reqStr } from "@/lib/validation";
import { D, ZERO, round2, type Dec } from "@/lib/decimal";
import { fmtDate } from "@/lib/format";
import { ledgerDate, postJournal, type PostingLine } from "../accounting/ledger";
import { assertCostCenters } from "./accounting";
import { orderBy, paging, type ListArgs } from "./common";

const lockAsset = (tx: Tx, id: string) => tx.$queryRawUnsafe(`SELECT id FROM "FixedAsset" WHERE id = $1 FOR UPDATE`, id);

/** Last day of the month containing `d` (UTC date). */
export function monthEnd(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}
const monthsBetween = (a: Date, b: Date) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();

export const assetSchema = z.object({
  name: reqStr(200),
  categoryId: reqStr(40),
  serialNo: optStr(100),
  location: optStr(200),
  costCenterId: optId,
  acquisitionDate: optDate,
  depreciationStart: optDate,
  cost: posDecimal,
  salvageValue: nonNegDecimal.default("0"),
  usefulLifeMonths: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(1).max(600).optional()),
  openingAccumulated: nonNegDecimal.default("0"),
  purchaseInvoiceId: optId,
  notes: optStr(2000),
});

function checkValues(cost: Dec, salvage: Dec, opening: Dec) {
  if (salvage.gte(cost)) throw new AppError("Salvage value must be less than the cost.");
  if (opening.gt(cost.sub(salvage))) throw new AppError("Opening accumulated depreciation cannot exceed cost less salvage value.");
}

export async function saveAsset(ctx: Ctx, id: string | null, raw: unknown) {
  requirePerm(ctx, "accounting.assets.manage");
  const d = assetSchema.parse(raw);
  return withTx(async (tx) => {
    const cat = await tx.assetCategory.findUniqueOrThrow({ where: { id: d.categoryId } });
    await assertCostCenters(tx, [d.costCenterId]);
    const cost = round2(D(d.cost)), salvage = round2(D(d.salvageValue)), opening = round2(D(d.openingAccumulated));
    checkValues(cost, salvage, opening);
    const acquisitionDate = ledgerDate(d.acquisitionDate ?? new Date());
    const data = {
      name: d.name, categoryId: cat.id, serialNo: d.serialNo, location: d.location, costCenterId: d.costCenterId ?? null, acquisitionDate,
      depreciationStart: ledgerDate(d.depreciationStart ?? acquisitionDate), cost, salvageValue: salvage, usefulLifeMonths: d.usefulLifeMonths ?? cat.usefulLifeMonths,
      openingAccumulated: opening, accumulatedDepreciation: opening, purchaseInvoiceId: d.purchaseInvoiceId ?? null, notes: d.notes,
    };
    if (id) {
      await lockAsset(tx, id);
      const before = await tx.fixedAsset.findUniqueOrThrow({ where: { id } });
      if (before.status !== "DRAFT") throw new AppError("Only draft assets can be edited; capitalised assets change through depreciation or disposal.");
      const a = await tx.fixedAsset.update({ where: { id }, data });
      await audit(tx, ctx, { action: "UPDATE", entity: "FixedAsset", entityId: id, summary: `Edited draft asset ${a.number}`, before, after: a });
      return a;
    }
    const number = await nextNumber(tx, "FIXED_ASSET");
    const a = await tx.fixedAsset.create({ data: { ...data, number, createdById: ctx.userId } });
    await audit(tx, ctx, { action: "CREATE", entity: "FixedAsset", entityId: a.id, summary: `Registered asset ${number} ${a.name}` });
    return a;
  });
}

/**
 * Capitalises a draft asset: Dr asset cost; Cr accumulated depreciation for any
 * opening amount; Cr the funding account (where the purchase was booked, the
 * bank, or opening-balance equity for assets brought over from another system).
 */
export async function capitaliseAsset(ctx: Ctx, id: string, fundingAccountId: string) {
  requirePerm(ctx, "accounting.assets.manage");
  return withTx(async (tx) => {
    await lockAsset(tx, id);
    const a = await tx.fixedAsset.findUniqueOrThrow({ where: { id }, include: { category: true } });
    if (a.status !== "DRAFT") throw new AppError(`${a.number} is already capitalised.`);
    const fund = await tx.account.findUnique({ where: { id: fundingAccountId } });
    if (!fund || fund.isGroup || !fund.active) throw new AppError("Choose an active, non-group funding account.");
    if (fund.id === a.category.assetAccountId) throw new AppError("The funding account cannot be the asset account itself.");
    const cost = D(a.cost), opening = D(a.openingAccumulated);
    await postJournal(tx, ctx, {
      date: a.acquisitionDate, type: "ASSET", memo: `Capitalise ${a.number} ${a.name}`, source: { type: "FixedAsset", id: a.id, no: a.number },
      lines: [
        { account: { id: a.category.assetAccountId }, debit: cost, description: a.name },
        { account: { id: a.category.accumulatedAccountId }, credit: opening, description: "Depreciation before go-live" },
        { account: { id: fund.id }, credit: cost.sub(opening), description: a.name },
      ],
    });
    const remaining = cost.sub(D(a.salvageValue)).sub(opening);
    await tx.fixedAsset.update({ where: { id }, data: { status: remaining.gt(0) ? "ACTIVE" : "FULLY_DEPRECIATED", fundingAccountId: fund.id, capitalisedAt: new Date() } });
    await audit(tx, ctx, { action: "POST", entity: "FixedAsset", entityId: id, summary: `Capitalised ${a.number} at ${cost.toFixed(2)} (funded from ${fund.code} ${fund.name})` });
  });
}

/** Depreciation due for an asset up to a month end: straight line, catching up missed months, never below salvage. */
export function depreciationDue(a: { cost: Dec; salvageValue: Dec; usefulLifeMonths: number; accumulatedDepreciation: Dec; depreciationStart: Date }, lastPeriod: Date | null, periodEnd: Date) {
  const firstDue = lastPeriod ? monthEnd(new Date(Date.UTC(lastPeriod.getUTCFullYear(), lastPeriod.getUTCMonth() + 1, 1))) : monthEnd(a.depreciationStart);
  if (firstDue > periodEnd) return { months: 0, amount: ZERO };
  const months = monthsBetween(firstDue, periodEnd) + 1;
  const monthly = D(a.cost).sub(D(a.salvageValue)).div(a.usefulLifeMonths);
  const remaining = D(a.cost).sub(D(a.salvageValue)).sub(D(a.accumulatedDepreciation));
  const amount = round2(monthly.mul(months));
  return { months, amount: amount.gt(remaining) ? remaining : amount };
}

/** Posts depreciation for every active asset up to the month end of `date` (one journal, one line pair per asset). */
export async function runDepreciation(ctx: Ctx, date: Date) {
  requirePerm(ctx, "accounting.assets.manage");
  const periodEnd = monthEnd(ledgerDate(date));
  return withTx(async (tx) => {
    const assets = await tx.fixedAsset.findMany({ where: { status: "ACTIVE", depreciationStart: { lte: periodEnd } }, include: { category: true }, orderBy: { number: "asc" } });
    const lines: PostingLine[] = [];
    const charges: { id: string; amount: Dec; full: boolean }[] = [];
    for (const a of assets) {
      await lockAsset(tx, a.id);
      const last = await tx.depreciationEntry.findFirst({ where: { assetId: a.id }, orderBy: { periodEnd: "desc" } });
      if (last && last.periodEnd >= periodEnd) continue;
      const due = depreciationDue({ ...a, cost: D(a.cost), salvageValue: D(a.salvageValue), accumulatedDepreciation: D(a.accumulatedDepreciation) }, last?.periodEnd ?? null, periodEnd);
      if (!due.amount.gt(0)) continue;
      const label = `${a.number} ${a.name}${due.months > 1 ? ` (${due.months} months)` : ""}`;
      lines.push({ account: { id: a.category.expenseAccountId }, debit: due.amount, description: label, costCenterId: a.costCenterId });
      lines.push({ account: { id: a.category.accumulatedAccountId }, credit: due.amount, description: label });
      const left = D(a.cost).sub(D(a.salvageValue)).sub(D(a.accumulatedDepreciation)).sub(due.amount);
      charges.push({ id: a.id, amount: due.amount, full: !left.gt(0) });
    }
    if (!charges.length) return { assets: 0, total: ZERO, periodEnd };
    const iso = periodEnd.toISOString().slice(0, 10);
    const j = await postJournal(tx, ctx, {
      date: periodEnd, type: "DEPRECIATION", memo: `Depreciation to ${fmtDate(periodEnd)}`,
      source: { type: "Depreciation", id: iso, no: `DEP-${iso.slice(0, 7)}`, kind: `POST-${Date.now()}` }, lines,
    });
    for (const c of charges) {
      await tx.depreciationEntry.create({ data: { assetId: c.id, periodEnd, amount: c.amount, journalId: j!.id } });
      await tx.fixedAsset.update({ where: { id: c.id }, data: { accumulatedDepreciation: { increment: c.amount }, ...(c.full ? { status: "FULLY_DEPRECIATED" } : {}) } });
    }
    const total = charges.reduce((s, c) => s.add(c.amount), ZERO);
    await audit(tx, ctx, { action: "POST", entity: "Depreciation", entityId: j!.id, summary: `Depreciation to ${fmtDate(periodEnd)}: ${charges.length} asset(s), ${total.toFixed(2)}` });
    return { assets: charges.length, total, periodEnd, journalId: j!.id };
  });
}

export const disposalSchema = z.object({ date: optDate, proceeds: nonNegDecimal.default("0"), proceedsAccountId: optId, reason: reqStr(500) });

/** Disposes of an asset: removes cost and accumulated depreciation, books any proceeds and the gain or loss. */
export async function disposeAsset(ctx: Ctx, id: string, raw: unknown) {
  requirePerm(ctx, "accounting.assets.manage");
  const d = disposalSchema.parse(raw);
  return withTx(async (tx) => {
    await lockAsset(tx, id);
    const a = await tx.fixedAsset.findUniqueOrThrow({ where: { id }, include: { category: true } });
    if (!["ACTIVE", "FULLY_DEPRECIATED"].includes(a.status)) throw new AppError(`${a.number} cannot be disposed of (status ${a.status.toLowerCase()}).`);
    const date = ledgerDate(d.date ?? new Date());
    if (a.status === "ACTIVE") {
      const prevMonthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0));
      const last = await tx.depreciationEntry.findFirst({ where: { assetId: id }, orderBy: { periodEnd: "desc" } });
      if (a.depreciationStart <= prevMonthEnd && (!last || last.periodEnd < prevMonthEnd)) {
        throw new AppError(`Run depreciation up to ${fmtDate(prevMonthEnd)} before disposing of ${a.number}.`);
      }
    }
    const proceeds = round2(D(d.proceeds));
    let proceedsAccount: string | null = null;
    if (proceeds.gt(0)) {
      const acc = d.proceedsAccountId ? await tx.account.findUnique({ where: { id: d.proceedsAccountId } }) : null;
      if (!acc || acc.isGroup || !acc.active) throw new AppError("Choose the account the sale proceeds were received into.");
      proceedsAccount = acc.id;
    }
    const cost = D(a.cost), accum = D(a.accumulatedDepreciation);
    const loss = cost.sub(accum).sub(proceeds); // positive = loss
    await postJournal(tx, ctx, {
      date, type: "ASSET", memo: `Disposal of ${a.number} ${a.name}: ${d.reason}`, source: { type: "FixedAsset", id: a.id, no: a.number, kind: "DISPOSE" },
      lines: [
        { account: { id: a.category.accumulatedAccountId }, debit: accum, description: "Accumulated depreciation removed" },
        ...(proceedsAccount ? [{ account: { id: proceedsAccount }, debit: proceeds, description: "Sale proceeds" }] : []),
        { account: { id: a.category.assetAccountId }, credit: cost, description: "Cost removed" },
        { account: "ASSET_DISPOSAL" as const, debit: loss, description: loss.gt(0) ? "Loss on disposal" : "Gain on disposal", costCenterId: a.costCenterId },
      ],
    });
    await tx.fixedAsset.update({ where: { id }, data: { status: "DISPOSED", disposedAt: date, disposalProceeds: proceeds } });
    await audit(tx, ctx, { action: "DISPOSE", entity: "FixedAsset", entityId: id, summary: `Disposed of ${a.number}: proceeds ${proceeds.toFixed(2)}, ${loss.gt(0) ? "loss" : "gain"} ${loss.abs().toFixed(2)} — ${d.reason}` });
    return { gainOrLoss: loss.neg() };
  });
}

export async function listAssets(ctx: Ctx, a: ListArgs & { status?: string; categoryId?: string }) {
  requirePerm(ctx, "accounting.view");
  const where: Prisma.FixedAssetWhereInput = {
    ...(a.status ? { status: a.status } : {}),
    ...(a.categoryId ? { categoryId: a.categoryId } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { name: { contains: a.q, mode: "insensitive" } }, { serialNo: { contains: a.q, mode: "insensitive" } }, { location: { contains: a.q, mode: "insensitive" } }] } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total, sums] = await Promise.all([
    prisma.fixedAsset.findMany({ where, skip, take, include: { category: { select: { name: true } } }, orderBy: orderBy(a, ["number", "name", "acquisitionDate", "cost", "status"], { number: "asc" }) }),
    prisma.fixedAsset.count({ where }),
    prisma.fixedAsset.aggregate({ where: { ...where, status: { in: ["ACTIVE", "FULLY_DEPRECIATED"] } }, _sum: { cost: true, accumulatedDepreciation: true } }),
  ]);
  return { rows, total, page, pageSize, totals: { cost: D(sums._sum.cost), accumulated: D(sums._sum.accumulatedDepreciation) } };
}

export const categorySchema = z.object({
  name: reqStr(120), assetAccountId: reqStr(40), accumulatedAccountId: reqStr(40), expenseAccountId: reqStr(40),
  usefulLifeMonths: z.coerce.number().int().min(1).max(600).default(60),
});

export async function saveAssetCategory(ctx: Ctx, id: string | null, raw: unknown) {
  requirePerm(ctx, "accounting.assets.manage");
  const d = categorySchema.parse(raw);
  return withTx(async (tx) => {
    const accts = await tx.account.findMany({ where: { id: { in: [d.assetAccountId, d.accumulatedAccountId, d.expenseAccountId] } } });
    const get = (aid: string) => accts.find((x) => x.id === aid);
    if ([d.assetAccountId, d.accumulatedAccountId, d.expenseAccountId].some((aid) => { const x = get(aid); return !x || x.isGroup || !x.active; })) throw new AppError("Choose active, non-group accounts.");
    if (get(d.assetAccountId)!.type !== "ASSET" || get(d.accumulatedAccountId)!.type !== "ASSET") throw new AppError("The asset and accumulated depreciation accounts must be asset accounts.");
    if (get(d.expenseAccountId)!.type !== "EXPENSE") throw new AppError("The depreciation account must be an expense account.");
    const dup = await tx.assetCategory.findUnique({ where: { name: d.name } });
    if (dup && dup.id !== id) throw new AppError(`Category ${d.name} already exists.`);
    const c = id ? await tx.assetCategory.update({ where: { id }, data: d }) : await tx.assetCategory.create({ data: d });
    await audit(tx, ctx, { action: id ? "UPDATE" : "CREATE", entity: "AssetCategory", entityId: c.id, summary: `${id ? "Updated" : "Created"} asset category ${c.name}` });
    return c;
  });
}
