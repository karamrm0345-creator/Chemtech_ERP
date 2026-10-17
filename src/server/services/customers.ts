import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, withTx, type Tx } from "../db";
import { requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { nextNumber } from "../numbering";
import { NotFoundError } from "../errors";
import { email, nonNegDecimal, optId, optStr, reqStr } from "@/lib/validation";
import { orderBy, paging, type ListArgs } from "./common";

export const customerSchema = z.object({
  code: optStr(30),
  legalName: reqStr(200),
  tradingName: optStr(200),
  category: z.enum(["OPERATOR", "EPC_CONTRACTOR", "INDUSTRIAL", "TRADING", "GOVERNMENT", "OTHER"]).default("OTHER"),
  classification: optStr(20),
  country: reqStr(80).default("Qatar"),
  city: optStr(80),
  address: optStr(500),
  email,
  phone: optStr(40),
  taxRegNo: optStr(50),
  crNumber: optStr(50),
  paymentTerms: optStr(100),
  paymentTermDays: z.coerce.number().int().min(0).max(365).default(30),
  creditLimit: nonNegDecimal.default("0"),
  currency: reqStr(3).default("QAR"),
  salesRepId: optId,
  notes: optStr(2000),
  active: z.boolean().default(true),
});
export type CustomerInput = z.input<typeof customerSchema>;

export const contactSchema = z.object({
  name: reqStr(120), title: optStr(80), department: optStr(80), email, phone: optStr(40), isPrimary: z.boolean().default(false),
});

const normalize = (s: string) => s.toLowerCase().replace(/\b(w\.?l\.?l|llc|ltd|co|company|qpsc|qsc|est|establishment)\b/g, "").replace(/[^a-z0-9]/g, "");

/** Possible duplicates by normalized name, email, phone or CR number. */
export async function findCustomerDuplicates(tx: Tx, input: { legalName: string; email?: string; phone?: string; crNumber?: string }, excludeId?: string) {
  const norm = normalize(input.legalName);
  const candidates = await tx.customer.findMany({
    where: {
      id: excludeId ? { not: excludeId } : undefined,
      OR: [
        { legalName: { contains: input.legalName.slice(0, 6), mode: "insensitive" } },
        ...(input.email ? [{ email: input.email }] : []),
        ...(input.phone ? [{ phone: input.phone }] : []),
        ...(input.crNumber ? [{ crNumber: input.crNumber }] : []),
      ],
    },
    select: { id: true, code: true, legalName: true, email: true, phone: true, crNumber: true },
    take: 20,
  });
  return candidates.filter(
    (c) => normalize(c.legalName) === norm || (input.email && c.email === input.email) ||
      (input.phone && c.phone === input.phone) || (input.crNumber && c.crNumber === input.crNumber),
  );
}

export async function createCustomer(ctx: Ctx, raw: unknown, opts: { ignoreDuplicates?: boolean } = {}) {
  requirePerm(ctx, "customer.manage");
  const data = customerSchema.parse(raw);
  return withTx(async (tx) => {
    if (!opts.ignoreDuplicates) {
      const dups = await findCustomerDuplicates(tx, data as never);
      if (dups.length) {
        return { duplicates: dups, customer: null };
      }
    }
    const code = data.code ?? (await nextNumber(tx, "CUSTOMER"));
    const customer = await tx.customer.create({ data: { ...data, code, createdById: ctx.userId } });
    await audit(tx, ctx, { action: "CREATE", entity: "Customer", entityId: customer.id, summary: `Created customer ${code} ${data.legalName}`, after: customer });
    return { duplicates: [], customer };
  });
}

export async function updateCustomer(ctx: Ctx, id: string, raw: unknown) {
  requirePerm(ctx, "customer.manage");
  const data = customerSchema.parse(raw);
  return withTx(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Customer");
    const after = await tx.customer.update({ where: { id }, data: { ...data, code: data.code ?? before.code } });
    await audit(tx, ctx, { action: "UPDATE", entity: "Customer", entityId: id, summary: `Updated customer ${after.code}`, before, after });
    return after;
  });
}

export async function addCustomerContact(ctx: Ctx, customerId: string, raw: unknown) {
  requirePerm(ctx, "customer.manage");
  const data = contactSchema.parse(raw);
  return withTx(async (tx) => {
    if (data.isPrimary) await tx.customerContact.updateMany({ where: { customerId }, data: { isPrimary: false } });
    const c = await tx.customerContact.create({ data: { ...data, customerId } });
    await audit(tx, ctx, { action: "CREATE", entity: "CustomerContact", entityId: c.id, summary: `Added contact ${c.name}`, after: c });
    return c;
  });
}

export async function deleteCustomerContact(ctx: Ctx, contactId: string) {
  requirePerm(ctx, "customer.manage");
  return withTx(async (tx) => {
    const c = await tx.customerContact.findUnique({ where: { id: contactId }, include: { _count: { select: { quotations: true, orders: true } } } });
    if (!c) throw new NotFoundError("Contact");
    if (c._count.quotations || c._count.orders) {
      await tx.customerContact.update({ where: { id: contactId }, data: { name: `${c.name} (inactive)`, isPrimary: false } });
    } else {
      await tx.customerContact.delete({ where: { id: contactId } });
    }
    await audit(tx, ctx, { action: "DELETE", entity: "CustomerContact", entityId: contactId, before: c });
  });
}

export async function listCustomers(ctx: Ctx, a: ListArgs & { category?: string; active?: string }) {
  requirePerm(ctx, "customer.view");
  const where: Prisma.CustomerWhereInput = {
    ...(a.q ? { OR: [
      { legalName: { contains: a.q, mode: "insensitive" } }, { tradingName: { contains: a.q, mode: "insensitive" } },
      { code: { contains: a.q, mode: "insensitive" } }, { email: { contains: a.q, mode: "insensitive" } },
    ] } : {}),
    ...(a.category ? { category: a.category as never } : {}),
    ...(a.active === "active" ? { active: true } : a.active === "inactive" ? { active: false } : {}),
  };
  const { skip, take, page, pageSize } = paging(a);
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({ where, skip, take, orderBy: orderBy(a, ["code", "legalName", "category", "createdAt", "creditLimit"], { legalName: "asc" }) }),
    prisma.customer.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getCustomer(ctx: Ctx, id: string) {
  requirePerm(ctx, "customer.view");
  const c = await prisma.customer.findUnique({ where: { id }, include: { contacts: { orderBy: { isPrimary: "desc" } } } });
  if (!c) throw new NotFoundError("Customer");
  return c;
}
