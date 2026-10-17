import type { Tx } from "./db";
import { businessYear } from "@/lib/format";
import { AppError } from "./errors";

export const DOC_TYPES = {
  CUSTOMER: { prefix: "CUS", includeYear: false, padding: 5 },
  SUPPLIER: { prefix: "SUP", includeYear: false, padding: 5 },
  SALES_QUOTATION: { prefix: "SQ", includeYear: true, padding: 5 },
  SALES_ORDER: { prefix: "SO", includeYear: true, padding: 5 },
  DELIVERY_ORDER: { prefix: "DO", includeYear: true, padding: 5 },
  SALES_INVOICE: { prefix: "INV", includeYear: true, padding: 5 },
  CUSTOMER_PAYMENT: { prefix: "RCT", includeYear: true, padding: 5 },
  PURCHASE_REQUEST: { prefix: "PR", includeYear: true, padding: 5 },
  RFQ: { prefix: "RFQ", includeYear: true, padding: 5 },
  SUPPLIER_QUOTATION: { prefix: "SQT", includeYear: true, padding: 5 },
  PURCHASE_ORDER: { prefix: "PO", includeYear: true, padding: 5 },
  GOODS_RECEIPT: { prefix: "GRN", includeYear: true, padding: 5 },
  PURCHASE_RETURN: { prefix: "PRT", includeYear: true, padding: 5 },
  PURCHASE_INVOICE: { prefix: "PINV", includeYear: true, padding: 5 },
  SUPPLIER_PAYMENT: { prefix: "PAY", includeYear: true, padding: 5 },
  STOCK_DOCUMENT: { prefix: "STK", includeYear: true, padding: 5 },
  STOCK_COUNT: { prefix: "CNT", includeYear: true, padding: 5 },
} as const;

export type DocType = keyof typeof DOC_TYPES;

/**
 * Atomically allocates the next document number. The template row
 * (docType) holds prefix/padding; per-year counters live in "<docType>:<year>".
 * The UPSERT ... RETURNING is atomic, so concurrent callers never collide.
 */
export async function nextNumber(tx: Tx, docType: DocType): Promise<string> {
  const tpl = await tx.documentSequence.findUnique({ where: { docType } });
  const cfg = tpl ?? { ...DOC_TYPES[docType], docType };
  if (!cfg) throw new AppError(`No numbering configured for ${docType}`);
  const year = businessYear();
  const key = cfg.includeYear ? `${docType}:${year}` : `${docType}:all`;
  const rows = await tx.$queryRaw<{ n: number }[]>`
    INSERT INTO "DocumentSequence" ("docType", "prefix", "nextNumber", "padding", "includeYear")
    VALUES (${key}, ${cfg.prefix}, 2, ${cfg.padding}, ${cfg.includeYear})
    ON CONFLICT ("docType") DO UPDATE SET "nextNumber" = "DocumentSequence"."nextNumber" + 1
    RETURNING "nextNumber" - 1 AS n`;
  const n = String(rows[0].n).padStart(cfg.padding, "0");
  return cfg.includeYear ? `${cfg.prefix}-${year}-${n}` : `${cfg.prefix}-${n}`;
}
