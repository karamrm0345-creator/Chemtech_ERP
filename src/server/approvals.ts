import type { Tx } from "./db";
import type { Ctx } from "./context";
import { requirePerm } from "./context";
import { AppError } from "./errors";
import type { Permission } from "./auth/permissions";
import { D, type Dec } from "@/lib/decimal";
import { fmtMoney } from "@/lib/format";

export type ApprovalDocType =
  | "SALES_QUOTATION" | "SALES_ORDER" | "PURCHASE_REQUEST" | "PURCHASE_ORDER" | "STOCK_ADJUSTMENT";

/**
 * Central approval gate: permission + separation of duties (an approver may
 * not approve a document they prepared) + per-role monetary approval limit.
 * No limit row for the role/docType means no monetary cap.
 */
export async function assertCanApprove(
  tx: Tx, ctx: Ctx,
  opts: { docType: ApprovalDocType; permission: Permission; createdById: string; amountBase: Dec },
) {
  requirePerm(ctx, opts.permission);
  if (opts.createdById === ctx.userId) {
    throw new AppError("Separation of duties: you cannot approve a document you prepared.");
  }
  const limit = await tx.approvalLimit.findUnique({
    where: { roleId_docType: { roleId: ctx.roleId, docType: opts.docType } },
  });
  if (limit?.maxAmount != null && D(opts.amountBase).gt(limit.maxAmount)) {
    throw new AppError(
      `Amount ${fmtMoney(opts.amountBase)} exceeds your approval limit of ${fmtMoney(limit.maxAmount)}.`,
    );
  }
}

export async function recordApproval(
  tx: Tx, ctx: Ctx,
  r: { docType: string; docId: string; docNo: string; action: string; comment?: string | null; amount?: Dec | null },
) {
  await tx.approvalRecord.create({
    data: {
      docType: r.docType, docId: r.docId, docNo: r.docNo, action: r.action,
      userId: ctx.userId, comment: r.comment ?? null, amount: r.amount ?? null,
    },
  });
}
