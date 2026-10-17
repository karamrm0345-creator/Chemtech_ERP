import { parseBusinessDate } from "./format";

export type SP = Record<string, string | string[] | undefined>;

export function str(sp: SP, k: string): string | undefined {
  const v = sp[k];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() !== "" ? s.trim().slice(0, 200) : undefined;
}

export function listArgs(sp: SP) {
  const dir = str(sp, "dir");
  return {
    q: str(sp, "q"),
    page: Number(str(sp, "page") ?? 1) || 1,
    pageSize: Number(str(sp, "size") ?? 20) || 20,
    sort: str(sp, "sort"),
    dir: (dir === "asc" ? "asc" : dir === "desc" ? "desc" : undefined) as "asc" | "desc" | undefined,
  };
}

/** Inclusive date range from ?from=yyyy-mm-dd&to=yyyy-mm-dd (to = end of that day, Qatar time). */
export function dateRange(sp: SP) {
  const from = parseBusinessDate(str(sp, "from")) ?? undefined;
  const toStart = parseBusinessDate(str(sp, "to"));
  const to = toStart ? new Date(toStart.getTime() + 86_399_999) : undefined;
  return { from, to };
}

export function hrefWith(base: string, sp: SP, patch: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s) p.set(k, s);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") p.delete(k);
    else p.set(k, String(v));
  }
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}
