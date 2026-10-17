import { z } from "zod";
import type { Prisma, Supplier } from "@prisma/client";
import { prisma, withTx, type Tx } from "../db";
import { can, requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { nextNumber } from "../numbering";
import { NotFoundError } from "../errors";
import { email, optDate, optStr, reqStr } from "@/lib/validation";
import { orderBy, paging, type ListArgs } from "./common";
import { contactSchema } from "./customers";

export const BANK_FIELDS = ["bankName", "bankAccountName", "bankAccountNo", "iban", "swift"] as const;

export const supplierSchema = z.object({
  code: optStr(30),
  legalName: reqStr(200),
  tradingName: optStr(200),
  category: z.enum(["MANUFACTURER", "DISTRIBUTOR", "SERVICE_PROVIDER", "LOGISTICS", "CONTRACTOR", "OTHER"]).default("OTHER"),
  country: reqStr(80).default("Qatar"),
  city: optStr(80),
  address: optStr(500),
  email,
  phone: optStr(40),
  website: optStr(200),
  productsServices: optStr(2000),
  paymentTerms: optStr(100),
  paymentTermDays: z.coerce.number().int().min(0).max(365).default(30),
  currency: reqStr(3).default("QAR"),
  taxRegNo: optStr(50),
  crNumber: optStr(50),
  prequalStatus: z.enum(["NOT_STARTED", "PENDING", "APPROVED", "CONDITIONAL", "REJECTED", "EXPIRED"]).default("NOT_STARTED"),
  rating: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().min(0).max(5).optional()),
  notes: optStr(2000),
  active: z.boolean().default(true),
  bankName: optStr(120),
  bankAccountName: optStr(120),
  bankAccountNo: optStr(60),
  iban: optStr(40),
  swift: optStr(20),
});

export const supplierDocSchema = z.object({
  docType: reqStr(40), docNumber: optStr(80), issueDate: optDate, expiryDate: optDate, notes: optStr(500),
});

export const supplierIssueSchema = z.object({
  date: optDate, severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]).default("MINOR"), description: reqStr(2000),
  purchaseOrderId: optStr(40), goodsReceiptId: optStr(40),
});

/** Removes bank details unless the user may see them. */
export function maskSupplier<T extends Partial<Supplier>>(ctx: Ctx, s: T): T {
  if (can(ctx, "supplier.bank.view")) return s;
  const copy = { ...s };
  for (const f of BANK_FIELDS) if (f in copy) (copy as Record<string, unknown>)[f] = copy[f] ? "••••••" : null;
  return copy;
}

function stripBank(ctx: Ctx, data: z.infer<typeof supplierSchema>) {
  if (can(ctx, "supplier.bank.manage")) return data;
  const copy: Record<string, unknown> = { ...data };
  for (const f of BANK_FIELDS) delete copy[f];
  return copy as typeof data;
}

export async function findSupplierDuplicates(tx: Tx, input: { legalName: string; email?: string; crNumber?: string }, excludeId?: string) {
  const norm = input.legalName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const c = await tx.supplier.findMany({
    where: {
      id: excludeId ? { not: excludeId } : undefined,
      OR: [
        { legalName: { contains: input.legalName.slice(0, 6), mode: "insensitive" } },
        ...(input.email ? [{ email: input.email }] : []),
        ...(input.crNumber ? [{ crNumber: input.crNumber }] : []),
      ],
    },
    select: { id: true, code: true, legalName: true, email: true, crNumber: true },
    take: 20,
  });
  return c.filter((s) => s.legalName.toLowerCase().replace(/[^a-z0-9]/g, "") === norm ||
    (input.email && s.email === input.email) || (input.crNumber && s.crNumber === input.crNumber));
}

export async function createSupplier(ctx: Ctx, raw: unknown, opts: { ignoreDuplicates?: boolean } = {}) {
  requirePerm(ctx, "supplier.manage");
  const data = stripBank(ctx, supplierSchema.parse(raw));
  return withTx(async (tx) => {
    if (!opts.ignoreDuplicates) {
      const dups = await findSupplierDuplicates(tx, data as never);
      if (dups.length) return { duplicates: dups, supplier: null };
    }
    const code = data.code ?? (await nextNumber(tx, "SUPPLIER"));
    const supplier = await tx.supplier.create({ data: { ...data, code, createdById: ctx.userId } });
    await audit(tx, ctx, { action: "CREATE", entity: "Supplier", entityId: supplier.id, summary: `Created supplier ${code} ${data.legalName}`, after: maskSupplier({ ...ctx, permissions: new Set() }, supplier) });
    return { duplicates: [], supplier };
  });
}

export async function updateSupplier(ctx: Ctx, id: string, raw: unknown) {
  requirePerm(ctx, "supplier.manage");
  const data = stripBank(ctx, supplierSchema.parse(raw));
  return withTx(async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Supplier");
    const after = await tx.supplier.update({ where: { id }, data: { ...data, code: data.code ?? before.code } });
    const bankChanged = BANK_FIELDS.some((f) => before[f] !== after[f]);
    const anon = { ...ctx, permissions: new Set<string>() };
    await audit(tx, ctx, {
      action: "UPDATE", entity: "Supplier", entityId: id,
      summary: `Updated supplier ${after.code}${bankChanged ? " (bank details changed)" : ""}`,
      before: maskSupplier(anon, before), after: maskSupplier(anon, after),
    });
    return after;
  });
}

export async function addSupplierContact(ctx: Ctx, supplierId: string, raw: unknown) {
  requirePerm(ctx, "supplier.manage");
  const data = contactSchema.parse(raw);
  return withTx(async (tx) => {
    if (data.isPrimary) await tx.supplierContact.updateMany({ where: { supplierId }, data: { isPrimary: false } });
    const c = await tx.supplierContact.create({ data: { ...data, supplierId } });
    await audit(tx, ctx, { action: "CREATE", entity: "SupplierContact", entityId: c.id, summary: `Added contact ${c.name}` });
    return c;
  });
}

export async function deleteSupplierContact(ctx: Ctx, id: string) {
  requirePerm(ctx, "supplier.manage");
  return withTx(async (tx) => {
    const c = await tx.supplierContact.delete({ where: { id } });
    await audit(tx, ctx, { action: "DELETE", entity: "SupplierContact", entityId: id, before: c });
  });
}

export async function addSupplierDocument(ctx: Ctx, supplierId: string, raw: unknown) {
  requirePerm(ctx, "supplier.manage");
  const data = supplierDocSchema.parse(raw);
  return withTx(async (tx) => {
    const d = await tx.supplierDocument.create({ data: { ...data, supplierId } });
    await audit(tx, ctx, { action: "CREATE", entity: "SupplierDocument", entityId: d.id, summary: `Added ${d.docType} document`, after: d });
    return d;
  });
}

export async function deleteSupplierDocument(ctx: Ctx, id: string) {
  requirePerm(ctx, "supplier.manage");
  return withTx(async (tx) => {
    const d = await tx.supplierDocument.delete({ where: { id } });
    await audit(tx, ctx, { action: "DELETE", entity: "SupplierDocument", entityId: id, before: d });
  });
}

export async function addSupplierIssue(ctx: Ctx, supplierId: string, raw: unknown) {
  requirePerm(ctx, "supplier.manage");
  const data = supplierIssueSchema.parse(raw);
  return withTx(async (tx) => {
    const i = await tx.supplierIssue.create({ data: { ...data, date: data.date ?? new Date(), supplierId, createdById: ctx.userId } });
    await audit(tx, ctx, { action: "CREATE", entity: "SupplierIssue", entityId: i.id, summary: `Logged ${i.severity} nonconformity`, after: i });
    return i;
  });
}

export async function closeSupplierIssue(ctx: Ctx, id: string, resolution: string) {
  requirePerm(ctx, "supplier.manage");
  return withTx(async (tx) => {
    const i = await tx.supplierIssue.update({ where: { id }, data: { status: "CLOSED", resolution: resolution.slice(0, 2000) } });
    await audit(tx, ctx, { action: "CLOSE", entity: "SupplierIssue", entityId: id, after: i });
  });
}

export async function listSuppliers(ctx: Ctx, a: ListArgs & { category?: string; prequal?: string; active?: string }) {
  requirePerm(ctx, "supplier.view");
  const where: Prisma.SupplierWhereInput = {
    ...(a.q ? { OR: [
      { legalName: { contains: a.q, mode: "insensitive" } }, { code: { contains: a.q, mode: "insensitive" } },
      { productsServices: { contains: a.q, mode: "insensitive" } }, { email: { contains: a.q, mode: "insensitive" } },
    ] } : {}),
    ...(a.category ? { category: a.category as never } : {}),
    ...(a.prequal ? { prequalStatus: a.prequal as never } : {}),
    ...(a.active === "active" ? { active: true } : a.active === "inactive" ? { active: false } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.supplier.findMany({ where, skip, take, orderBy: orderBy(a, ["code", "legalName", "category", "prequalStatus", "rating"], { legalName: "asc" }) }),
    prisma.supplier.count({ where }),
  ]);
  return { rows: rows.map((r) => maskSupplier(ctx, r)), total, page, pageSize };
}

export async function getSupplier(ctx: Ctx, id: string) {
  requirePerm(ctx, "supplier.view");
  const s = await prisma.supplier.findUnique({
    where: { id },
    include: { contacts: { orderBy: { isPrimary: "desc" } }, documents: { orderBy: { expiryDate: "asc" } }, issues: { orderBy: { date: "desc" } } },
  });
  if (!s) throw new NotFoundError("Supplier");
  return maskSupplier(ctx, s);
}

/** On-time delivery: GRNs posted on/before the PO expected date. */
export async function supplierPerformance(supplierId: string) {
  const receipts = await prisma.goodsReceipt.findMany({
    where: { supplierId, status: "POSTED" },
    select: { date: true, purchaseOrder: { select: { expectedDate: true } }, lines: { select: { receivedQty: true, rejectedQty: true } } },
  });
  let onTime = 0, withDate = 0, received = 0, rejected = 0;
  for (const r of receipts) {
    if (r.purchaseOrder.expectedDate) {
      withDate++;
      if (r.date <= new Date(r.purchaseOrder.expectedDate.getTime() + 86_399_000)) onTime++;
    }
    for (const l of r.lines) { received += Number(l.receivedQty); rejected += Number(l.rejectedQty); }
  }
  const openIssues = await prisma.supplierIssue.count({ where: { supplierId, status: "OPEN" } });
  return {
    receipts: receipts.length,
    onTimePct: withDate ? Math.round((onTime / withDate) * 100) : null,
    rejectionPct: received ? Math.round((rejected / received) * 1000) / 10 : null,
    openIssues,
  };
}
