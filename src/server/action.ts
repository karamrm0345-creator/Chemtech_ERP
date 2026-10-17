import "server-only";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getSessionUser, type SessionUser } from "./auth/session";
import { AppError } from "./errors";

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/**
 * Wraps a server action: authenticates, maps known errors to user-safe
 * messages, logs unexpected ones, and revalidates the given paths on success.
 */
export async function runAction<T>(
  fn: (user: SessionUser) => Promise<T>,
  opts: { revalidate?: string[]; message?: string } = {},
): Promise<ActionResult<T>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
  try {
    const data = await fn(user);
    for (const p of opts.revalidate ?? []) revalidatePath(p, "layout");
    return { ok: true, data, message: opts.message };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof ZodError) {
    return e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return `A record with the same ${(e.meta?.target as string[] | undefined)?.join(", ") ?? "key"} already exists.`;
    if (e.code === "P2025") return "The record no longer exists or was changed by another user.";
    if (e.code === "P2003") return "This record is referenced by other records and cannot be changed this way.";
  }
  console.error("[action] unexpected error", e);
  return "An unexpected error occurred. The error has been logged.";
}
