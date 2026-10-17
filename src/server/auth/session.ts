import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { prisma } from "../db";
import type { Ctx } from "../context";
import type { Permission } from "./permissions";

export const SESSION_COOKIE = "ct_session";
const SESSION_HOURS = 12;

const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await prisma.session.create({
    data: {
      id: hashToken(token), userId, expiresAt,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent")?.slice(0, 250) ?? null,
    },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/", expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export interface SessionUser extends Ctx {
  email: string;
  roleName: string;
}

/** Validates the session cookie against the DB. Cached per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { include: { role: { include: { permissions: true } } } } },
  });
  if (!s || s.expiresAt < new Date() || !s.user.active) return null;
  const h = await headers();
  return {
    userId: s.user.id,
    userName: s.user.name,
    email: s.user.email,
    roleId: s.user.roleId,
    roleCode: s.user.role.code,
    roleName: s.user.role.name,
    permissions: new Set(s.user.role.permissions.map((p) => p.permission)),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
});

/** For pages: redirect to login when unauthenticated, 403 page when lacking permission. */
export async function requireUser(...perms: Permission[]): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  if (perms.length && !perms.some((p) => u.permissions.has(p))) redirect("/forbidden");
  return u;
}
