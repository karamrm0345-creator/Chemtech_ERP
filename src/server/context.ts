import { ForbiddenError } from "./errors";
import type { Permission } from "./auth/permissions";

/** The acting user, passed explicitly to every service function. */
export interface Ctx {
  userId: string;
  userName: string;
  roleId: string;
  roleCode: string;
  permissions: ReadonlySet<string>;
  ip?: string | null;
}

export function can(ctx: Ctx, p: Permission): boolean {
  return ctx.permissions.has(p);
}

export function requirePerm(ctx: Ctx, ...perms: Permission[]): void {
  for (const p of perms) if (!ctx.permissions.has(p)) throw new ForbiddenError();
}

export function requireAny(ctx: Ctx, ...perms: Permission[]): void {
  if (!perms.some((p) => ctx.permissions.has(p))) throw new ForbiddenError();
}
