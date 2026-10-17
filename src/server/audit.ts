import type { Prisma } from "@prisma/client";
import type { Tx } from "./db";
import type { Ctx } from "./context";

function sanitize(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  // Strips Decimal/Date into JSON-safe values and drops secrets.
  return JSON.parse(
    JSON.stringify(v, (k, val) => (k === "passwordHash" ? undefined : val)),
  ) as Prisma.InputJsonValue;
}

export async function audit(
  tx: Tx,
  ctx: Ctx | null,
  entry: { action: string; entity: string; entityId?: string | null; summary?: string; before?: unknown; after?: unknown },
) {
  await tx.auditLog.create({
    data: {
      userId: ctx?.userId ?? null,
      userName: ctx?.userName ?? null,
      ip: ctx?.ip ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      before: sanitize(entry.before),
      after: sanitize(entry.after),
    },
  });
}
