import { z } from "zod";
import { prisma, withTx } from "../db";
import { requirePerm, type Ctx } from "../context";
import { audit } from "../audit";
import { AppError } from "../errors";
import { ALL_PERMISSIONS } from "../auth/permissions";
import { hashPassword, passwordProblem } from "../auth/password";
import { email, nonNegDecimal, optStr, reqStr } from "@/lib/validation";

const userSchema = z.object({
  name: reqStr(120), email: email.refine((v) => !!v, "Email is required"), phone: optStr(40), department: optStr(80),
  roleId: reqStr(40), active: z.boolean().default(true), password: optStr(200),
});

export async function saveUser(ctx: Ctx, id: string | null, raw: unknown) {
  requirePerm(ctx, "admin.users");
  const d = userSchema.parse(raw);
  if (!id && !d.password) throw new AppError("An initial password is required.");
  if (d.password) { const p = passwordProblem(d.password); if (p) throw new AppError(p); }
  if (id === ctx.userId && !d.active) throw new AppError("You cannot deactivate your own account.");
  return withTx(async (tx) => {
    const data = {
      name: d.name, email: d.email!, phone: d.phone, department: d.department, roleId: d.roleId, active: d.active,
      ...(d.password ? { passwordHash: await hashPassword(d.password) } : {}),
    };
    const before = id ? await tx.user.findUnique({ where: { id } }) : null;
    const u = id ? await tx.user.update({ where: { id }, data }) : await tx.user.create({ data: data as typeof data & { passwordHash: string } });
    if (id && (!d.active || d.password || before?.roleId !== d.roleId)) await tx.session.deleteMany({ where: { userId: id } });
    await audit(tx, ctx, { action: id ? "UPDATE" : "CREATE", entity: "User", entityId: u.id, summary: `${id ? "Updated" : "Created"} user ${u.email}${d.password ? " (password set)" : ""}`, before, after: u });
    return u;
  });
}

const roleSchema = z.object({
  code: reqStr(40).transform((s) => s.toUpperCase().replace(/[^A-Z0-9_]/g, "_")), name: reqStr(80), description: optStr(300),
  permissions: z.array(z.string()).transform((p) => p.filter((x) => (ALL_PERMISSIONS as string[]).includes(x))),
  limits: z.array(z.object({ docType: z.string(), maxAmount: z.preprocess((v) => (v === "" || v == null ? null : v), nonNegDecimal.nullable()) })).default([]),
});

export async function saveRole(ctx: Ctx, id: string | null, raw: unknown) {
  requirePerm(ctx, "admin.roles");
  const d = roleSchema.parse(raw);
  return withTx(async (tx) => {
    const before = id ? await tx.role.findUnique({ where: { id }, include: { permissions: true, limits: true } }) : null;
    if (id && ctx.roleId === id && before?.permissions.some((p) => p.permission === "admin.roles") && !d.permissions.includes("admin.roles")) {
      throw new AppError("You cannot remove role-management permission from your own role.");
    }
    const role = id
      ? await tx.role.update({ where: { id }, data: { name: d.name, description: d.description, ...(before?.isSystem ? {} : { code: d.code }) } })
      : await tx.role.create({ data: { code: d.code, name: d.name, description: d.description } });
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    await tx.rolePermission.createMany({ data: d.permissions.map((permission) => ({ roleId: role.id, permission })) });
    await tx.approvalLimit.deleteMany({ where: { roleId: role.id } });
    const limits = d.limits.filter((l) => l.maxAmount !== undefined);
    if (limits.length) await tx.approvalLimit.createMany({ data: limits.map((l) => ({ roleId: role.id, docType: l.docType, maxAmount: l.maxAmount })) });
    await tx.session.deleteMany({ where: { user: { roleId: role.id } } }).catch(() => undefined);
    await audit(tx, ctx, { action: id ? "UPDATE" : "CREATE", entity: "Role", entityId: role.id, summary: `${id ? "Updated" : "Created"} role ${role.code} (${d.permissions.length} permissions)`, before, after: d });
    return role;
  });
}

const settingsSchema = z.object({
  companyName: reqStr(120), legalName: optStr(200), crNumber: optStr(50), taxNumber: optStr(50), address: optStr(500),
  phone: optStr(40), email, website: optStr(200), baseCurrency: reqStr(3), defaultTaxRate: nonNegDecimal,
  financeEnabled: z.boolean(), allowNegativeStock: z.boolean(), grnTolerancePct: nonNegDecimal, requirePrApproval: z.boolean(),
  requireRfq: z.boolean(), requirePrForPo: z.boolean(), adjustmentAlertQty: nonNegDecimal, slowMovingDays: z.coerce.number().int().min(1).max(3650),
});

export async function saveSettings(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "admin.settings");
  const d = settingsSchema.parse(raw);
  return withTx(async (tx) => {
    const before = await tx.companySettings.findUnique({ where: { id: 1 } });
    if (before && before.baseCurrency !== d.baseCurrency) {
      const used = await tx.inventoryTransaction.count();
      if (used) throw new AppError("The base currency cannot change after transactions exist.");
    }
    const after = await tx.companySettings.update({ where: { id: 1 }, data: d });
    await audit(tx, ctx, { action: "UPDATE", entity: "CompanySettings", entityId: "1", summary: "Updated company settings", before, after });
    return after;
  });
}

export async function saveSequence(ctx: Ctx, docType: string, raw: unknown) {
  requirePerm(ctx, "admin.settings");
  const d = z.object({ prefix: reqStr(10).transform((s) => s.toUpperCase()), padding: z.coerce.number().int().min(3).max(10), includeYear: z.boolean() }).parse(raw);
  return withTx(async (tx) => {
    const s = await tx.documentSequence.update({ where: { docType }, data: d });
    await audit(tx, ctx, { action: "UPDATE", entity: "DocumentSequence", entityId: docType, summary: `Numbering ${docType}: ${d.prefix}`, after: s });
    return s;
  });
}

export async function saveCurrency(ctx: Ctx, raw: unknown) {
  requirePerm(ctx, "admin.settings");
  const d = z.object({ code: reqStr(3).transform((s) => s.toUpperCase()), name: reqStr(60), rateToBase: nonNegDecimal, active: z.boolean().default(true) }).parse(raw);
  return withTx(async (tx) => {
    const c = await tx.currency.upsert({ where: { code: d.code }, create: d, update: d });
    await audit(tx, ctx, { action: "UPDATE", entity: "Currency", entityId: d.code, summary: `Currency ${d.code} rate ${d.rateToBase}`, after: c });
    return c;
  });
}

export async function saveCriterion(ctx: Ctx, id: string | null, raw: unknown) {
  requirePerm(ctx, "admin.settings");
  const d = z.object({ name: reqStr(80), weight: nonNegDecimal, active: z.boolean().default(true), sort: z.coerce.number().int().default(0) }).parse(raw);
  return withTx(async (tx) => {
    const c = id ? await tx.evaluationCriterion.update({ where: { id }, data: d }) : await tx.evaluationCriterion.create({ data: d });
    await audit(tx, ctx, { action: id ? "UPDATE" : "CREATE", entity: "EvaluationCriterion", entityId: c.id, summary: `Criterion ${c.name}` });
    return c;
  });
}

export async function userCount() {
  return prisma.user.count();
}
