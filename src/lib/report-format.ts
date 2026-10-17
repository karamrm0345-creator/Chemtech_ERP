import type { ColType } from "@/server/services/reports";
import { fmtAmount, fmtDate, fmtDateTime, fmtQty, humanize } from "./format";

export function formatCell(v: unknown, type?: ColType): string {
  if (v === null || v === undefined || v === "") return "";
  switch (type) {
    case "money": return fmtAmount(v as number);
    case "qty": return fmtQty(v as number);
    case "int": return String(v);
    case "pct": return `${v}%`;
    case "date": return fmtDate(v as Date);
    case "datetime": return fmtDateTime(v as Date);
    default: return /^[A-Z][A-Z_]+$/.test(String(v)) ? humanize(String(v)) : String(v);
  }
}
