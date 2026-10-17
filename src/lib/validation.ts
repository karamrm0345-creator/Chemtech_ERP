import { z } from "zod";
import { parseBusinessDate } from "./format";

/** Empty string → undefined, trims, caps length. */
export const optStr = (max = 500) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v ?? undefined), z.string().max(max).optional());

export const reqStr = (max = 200) => z.string({ required_error: "Required" }).trim().min(1, "Required").max(max);

export const decimalStr = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? "0" : String(v)),
  z.string().regex(/^-?\d+(\.\d+)?$/, "Must be a number"),
);

export const posDecimal = decimalStr.refine((v) => Number(v) > 0, "Must be greater than zero");
export const nonNegDecimal = decimalStr.refine((v) => Number(v) >= 0, "Cannot be negative");
export const pctDecimal = decimalStr.refine((v) => Number(v) >= 0 && Number(v) <= 100, "Must be between 0 and 100");

export const optDate = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? parseBusinessDate(v) : v),
  z.date().optional(),
);

export const optId = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().max(40).optional());

export const email = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim().toLowerCase() : v),
  z.string().email("Invalid email").max(200).optional(),
);

export const commercialLine = z.object({
  itemId: optId,
  description: reqStr(500),
  quantity: posDecimal,
  uom: optStr(20),
  unitPrice: nonNegDecimal,
  discountPct: pctDecimal.optional().default("0"),
  taxRate: pctDecimal.optional().default("0"),
});
export type CommercialLine = z.infer<typeof commercialLine>;
