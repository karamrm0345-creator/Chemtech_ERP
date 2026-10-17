import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma, withTx } from "../db";
import { can, requirePerm, type Ctx } from "../context";
import type { Permission } from "../auth/permissions";
import { audit } from "../audit";
import { AppError, ForbiddenError, NotFoundError } from "../errors";

// Files live OUTSIDE the public folder and are streamed through an
// authenticated route that re-checks the owning record's view permission.
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./storage/uploads");
export const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/msword": [".doc"], "application/vnd.ms-excel": [".xls"],
  "text/csv": [".csv"], "text/plain": [".txt"],
};

/** Which permission is needed to view attachments of each record type. */
export const DOC_VIEW_PERMISSION: Record<string, Permission> = {
  CUSTOMER: "customer.view", SUPPLIER: "supplier.view", ITEM: "item.view",
  SALES_QUOTATION: "sales.view", SALES_ORDER: "sales.view", DELIVERY_ORDER: "sales.view",
  PURCHASE_REQUEST: "purchase.view", RFQ: "purchase.view", SUPPLIER_QUOTATION: "purchase.view",
  PURCHASE_ORDER: "purchase.view", GOODS_RECEIPT: "purchase.view",
  SALES_INVOICE: "finance.view", PURCHASE_INVOICE: "finance.view", COMPANY: "admin.settings",
};

/** Checks magic bytes for the most common binary types to stop disguised files. */
function sniff(buf: Buffer, mime: string): boolean {
  const hex = buf.subarray(0, 8).toString("hex");
  if (mime === "application/pdf") return buf.subarray(0, 5).toString() === "%PDF-";
  if (mime === "image/png") return hex.startsWith("89504e47");
  if (mime === "image/jpeg") return hex.startsWith("ffd8ff");
  if (mime === "image/webp") return buf.subarray(8, 12).toString() === "WEBP";
  if (mime.includes("openxmlformats")) return hex.startsWith("504b0304");
  if (mime === "application/msword" || mime === "application/vnd.ms-excel") return hex.startsWith("d0cf11e0");
  return !buf.subarray(0, 4096).includes(0); // text types: no NUL bytes
}

export async function saveAttachment(ctx: Ctx, docType: string, docId: string, file: File, category = "GENERAL") {
  requirePerm(ctx, "attachment.upload");
  const viewPerm = DOC_VIEW_PERMISSION[docType];
  if (!viewPerm) throw new AppError("Unsupported attachment target.");
  if (!can(ctx, viewPerm)) throw new ForbiddenError();
  if (file.size === 0) throw new AppError("The file is empty.");
  if (file.size > MAX_BYTES) throw new AppError("Files may not exceed 10 MB.");
  const ext = path.extname(file.name).toLowerCase();
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED[mime]?.includes(ext)) throw new AppError("File type not allowed. Use PDF, images, Word, Excel, CSV or text.");
  const buf = Buffer.from(await file.arrayBuffer());
  if (!sniff(buf, mime)) throw new AppError("The file content does not match its type.");
  const storedName = `${crypto.randomUUID()}${ext}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), buf, { mode: 0o600 });
  const safeName = path.basename(file.name).replace(/[^\w.\- ()]/g, "_").slice(0, 200);
  return withTx(async (tx) => {
    const a = await tx.attachment.create({
      data: {
        docType, docId, category: category.slice(0, 40), fileName: safeName, storedName, mimeType: mime, size: buf.length,
        sha256: crypto.createHash("sha256").update(buf).digest("hex"), uploadedById: ctx.userId,
      },
    });
    await audit(tx, ctx, { action: "UPLOAD", entity: "Attachment", entityId: a.id, summary: `Uploaded ${safeName} to ${docType}` });
    return a;
  });
}

export async function readAttachment(ctx: Ctx, id: string) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a) throw new NotFoundError("Attachment");
  const perm = DOC_VIEW_PERMISSION[a.docType];
  if (!perm || !can(ctx, perm)) throw new ForbiddenError();
  const full = path.join(UPLOAD_DIR, path.basename(a.storedName));
  const data = await fs.readFile(full);
  return { meta: a, data };
}

export async function deleteAttachment(ctx: Ctx, id: string) {
  requirePerm(ctx, "attachment.delete");
  return withTx(async (tx) => {
    const a = await tx.attachment.delete({ where: { id } });
    await fs.rm(path.join(UPLOAD_DIR, path.basename(a.storedName)), { force: true });
    await audit(tx, ctx, { action: "DELETE", entity: "Attachment", entityId: id, summary: `Deleted ${a.fileName}`, before: a });
  });
}

export async function listAttachments(docType: string, docId: string) {
  return prisma.attachment.findMany({ where: { docType, docId }, orderBy: { createdAt: "desc" } });
}
