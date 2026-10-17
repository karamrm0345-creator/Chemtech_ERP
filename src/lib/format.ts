// Consistent business formatting. Business time zone defaults to Asia/Qatar.
export const BUSINESS_TZ = "Asia/Qatar";

type Num = number | string | { toString(): string } | null | undefined;

function toNum(v: Num): number {
  if (v === null || v === undefined || v === "") return 0;
  return typeof v === "number" ? v : Number(v.toString());
}

export function fmtMoney(v: Num, currency = "QAR"): string {
  return `${currency} ${toNum(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtAmount(v: Num): string {
  return toNum(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtQty(v: Num): string {
  return toNum(v).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function fmtCompact(v: Num): string {
  return toNum(v).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { timeZone: BUSINESS_TZ, day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    timeZone: BUSINESS_TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** yyyy-mm-dd in the business time zone, for <input type="date">. */
export function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });
}

export function businessYear(d = new Date()): number {
  return Number(d.toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ }).slice(0, 4));
}

/** Parse a yyyy-mm-dd string as midnight in Qatar (UTC+3, no DST). */
export function parseBusinessDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00+03:00`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function humanize(s: string | null | undefined): string {
  if (!s) return "—";
  return s.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
