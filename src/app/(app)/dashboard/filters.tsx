"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { EntityPicker } from "@/components/forms/entity-picker";

const PRESETS = [
  ["mtd", "This month"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["ytd", "Year to date"], ["12m", "Last 12 months"], ["custom", "Custom range"],
] as const;

/** Single filter row scoping every KPI and chart below it. */
export function DashboardFilters({ categories, customerLabel, supplierLabel }: { categories: { value: string; label: string }[]; customerLabel?: string; supplierLabel?: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    start(() => router.replace(`${path}?${p}`, { scroll: false }));
  };
  const range = sp.get("range") ?? "12m";
  return (
    <div className="no-print mb-5 flex flex-wrap items-end gap-2">
      <select aria-label="Period" className="input w-auto" value={range} onChange={(e) => set({ range: e.target.value })}>
        {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {range === "custom" && <>
        <input type="date" aria-label="From" className="input w-auto" value={sp.get("from") ?? ""} onChange={(e) => set({ from: e.target.value })} />
        <input type="date" aria-label="To" className="input w-auto" value={sp.get("to") ?? ""} onChange={(e) => set({ to: e.target.value })} />
      </>}
      <div className="w-56"><EntityPicker entity="customers" value={sp.get("customerId")} initialLabel={customerLabel} placeholder="All customers" onChange={(o) => set({ customerId: o?.id ?? null })} /></div>
      <div className="w-56"><EntityPicker entity="suppliers" value={sp.get("supplierId")} initialLabel={supplierLabel} placeholder="All suppliers" onChange={(o) => set({ supplierId: o?.id ?? null })} /></div>
      <select aria-label="Category" className="input w-auto" value={sp.get("categoryId") ?? ""} onChange={(e) => set({ categoryId: e.target.value || null })}>
        <option value="">All categories</option>{categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {pending && <Loader2 className="mb-2.5 h-4 w-4 animate-spin text-ink-muted" />}
    </div>
  );
}
