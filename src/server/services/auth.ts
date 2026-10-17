import "server-only";
import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { hashPassword, passwordProblem, verifyPassword } from "../auth/password";
import { rateLimit, resetRateLimit } from "../auth/rate-limit";
import { createSession } from "../auth/session";
import { email, optStr, reqStr } from "@/lib/validation";

const DUMMY_HASH = "$2b$12$sPzw2pJn5zqMVTRQYP/doOuCFbzDUy7Q3Se0Td4TSus.BoYBqrR.K"; // hash of a random throwaway value

export async function login(rawEmail: string, password: string, ip: string) {
  const e = String(rawEmail ?? "").trim().toLowerCase().slice(0, 200);
  const key = `login:${ip}:${e}`;
  const rl = rateLimit(key, 5, 15 * 60_000);
  const ipRl = rateLimit(`login-ip:${ip}`, 30, 15 * 60_000);
  if (!rl.ok || !ipRl.ok) throw new AppError(`Too many sign-in attempts. Try again in ${Math.ceil(Math.max(rl.retryInSec, ipRl.retryInSec) / 60)} minute(s).`);
  const user = await prisma.user.findUnique({ where: { email: e } });
  // Constant-ish time: always run bcrypt even for unknown users.
  const ok = await verifyPassword(String(password ?? ""), user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.active) {
    await audit(prisma, null, { action: "LOGIN_FAILED", entity: "User", entityId: user?.id, summary: `Failed sign-in for ${e}`, after: { ip } });
    throw new AppError("Invalid email or password.");
  }
  resetRateLimit(key);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id);
  await audit(prisma, { userId: user.id, userName: user.name, roleId: user.roleId, roleCode: "", permissions: new Set(), ip }, { action: "LOGIN", entity: "User", entityId: user.id, summary: `${user.email} signed in` });
}

const setupSchema = z.object({
  companyName: reqStr(120), name: reqStr(120), email: email.refine((v) => !!v, "Email is required"),
  phone: optStr(40), password: z.string().min(1, "Password is required"),
});

/**
 * First-run setup: only works while there are no users at all. Creates the
 * company name and the first System Administrator account. There is no
 * default password anywhere in the system.
 */
export async function firstRunSetup(raw: unknown) {
  const d = setupSchema.parse(raw);
  const p = passwordProblem(d.password); if (p) throw new AppError(p);
  const hash = await hashPassword(d.password);
  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`LOCK TABLE "User" IN EXCLUSIVE MODE`;
    if ((await tx.user.count()) > 0) throw new AppError("Setup has already been completed.");
    const role = await tx.role.findUnique({ where: { code: "SYSTEM_ADMIN" } });
    if (!role) throw new AppError("Base data missing: run `npm run db:seed:base` first.");
    await tx.companySettings.update({ where: { id: 1 }, data: { companyName: d.companyName, phone: d.phone } });
    return tx.user.create({ data: { name: d.name, email: d.email!, phone: d.phone, passwordHash: hash, roleId: role.id } });
  });
  await audit(prisma, null, { action: "SETUP", entity: "User", entityId: user.id, summary: `First-run setup: administrator ${user.email} created` });
  await createSession(user.id);
}

export async function changeOwnPassword(userId: string, current: string, next: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, u.passwordHash))) throw new AppError("Current password is incorrect.");
  const p = passwordProblem(next); if (p) throw new AppError(p);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  await prisma.session.deleteMany({ where: { userId } });
  await audit(prisma, null, { action: "PASSWORD_CHANGE", entity: "User", entityId: userId, summary: `${u.email} changed their password` });
  await createSession(userId);
}
