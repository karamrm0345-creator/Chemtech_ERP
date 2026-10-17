"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X, Loader2 } from "lucide-react";

export interface FilterDef { name: string; label: string; options: { value: string; label: string }[] }

/** Search + filter bar that keeps state in the URL so lists are shareable and server-rendered. */
export function ListToolbar({ filters = [], dateRange = false, placeholder = "Search…", children }: {
  filters?: FilterDef[]; dateRange?: boolean; placeholder?: string; children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [pending, start] = useTransition();
  const first = useRef(true);

  const push = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    p.delete("page");
    start(() => router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false }));
  };

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => push({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = filters.some((f) => sp.get(f.name)) || sp.get("from") || sp.get("to") || sp.get("q");

  return (
    <div className="no-print mb-3 flex flex-wrap items-end gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search" className="input pl-9" />
        {pending && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-muted" />}
      </div>
      {filters.map((f) => (
        <select key={f.name} aria-label={f.label} value={sp.get(f.name) ?? ""} onChange={(e) => push({ [f.name]: e.target.value })} className="input w-auto min-w-[150px]">
          <option value="">{f.label}: All</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ))}
      {dateRange && (
        <>
          <input type="date" aria-label="From date" className="input w-auto" value={sp.get("from") ?? ""} onChange={(e) => push({ from: e.target.value })} />
          <input type="date" aria-label="To date" className="input w-auto" value={sp.get("to") ?? ""} onChange={(e) => push({ to: e.target.value })} />
        </>
      )}
      {active && (
        <button type="button" onClick={() => { setQ(""); start(() => router.replace(pathname, { scroll: false })); }} className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-sm text-ink-soft hover:text-ink">
          <X className="h-4 w-4" /> Clear
        </button>
      )}
      {children}
    </div>
  );
}
