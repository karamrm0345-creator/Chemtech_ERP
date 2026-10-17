import type { Tx } from "../db";
import { AppError } from "../errors";
import { D, round2, type Dec } from "@/lib/decimal";

export async function getSettings(tx: Tx) {
  const s = await tx.companySettings.findUnique({ where: { id: 1 } });
  if (!s) throw new AppError("Company settings are not initialised. Run the base seed.");
  return s;
}

export async function rateFor(tx: Tx, currency: string): Promise<Dec> {
  const s = await getSettings(tx);
  if (currency === s.baseCurrency) return D(1);
  const c = await tx.currency.findUnique({ where: { code: currency } });
  if (!c || !c.active) throw new AppError(`Currency ${currency} is not configured.`);
  return D(c.rateToBase);
}

export const toBase = (amount: Dec, rate: Dec) => round2(D(amount).mul(rate));

/** Row-locks a document header to serialize state transitions (prevents double posting). */
export async function lockRow(tx: Tx, table: string, id: string) {
  const allowed = new Set([
    "SalesQuotation", "SalesOrder", "DeliveryOrder", "SalesInvoice", "PurchaseRequest", "Rfq",
    "SupplierQuotation", "PurchaseOrder", "GoodsReceipt", "PurchaseReturn", "PurchaseInvoice",
    "StockDocument", "StockCount",
  ]);
  if (!allowed.has(table)) throw new Error("lockRow: table not allowed");
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
  if (!rows.length) throw new AppError("Record not found.", "NOT_FOUND");
}

export function assertStatus<S extends string>(current: S, allowed: S[], action: string) {
  if (!allowed.includes(current)) {
    throw new AppError(`Cannot ${action}: document status is ${current.replace(/_/g, " ").toLowerCase()}.`);
  }
}

export interface ListArgs {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: "asc" | "desc";
}

export function paging(a: ListArgs) {
  const pageSize = Math.min(Math.max(a.pageSize ?? 20, 5), 200);
  const page = Math.max(a.page ?? 1, 1);
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export function orderBy(a: ListArgs, allowed: string[], fallback: Record<string, "asc" | "desc">) {
  if (a.sort && allowed.includes(a.sort)) return { [a.sort]: a.dir === "asc" ? "asc" : "desc" } as Record<string, "asc" | "desc">;
  return fallback;
}
