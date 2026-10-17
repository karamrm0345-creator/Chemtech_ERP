"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EntityPicker } from "@/components/forms/entity-picker";

export function ReportExtraFilters({ customer, supplier, days }: { customer: boolean; supplier: boolean; days: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    router.replace(`${path}?${p}`, { scroll: false });
  };
  return (
    <>
      {customer && <div className="w-56"><EntityPicker entity="customers" value={sp.get("customerId")} placeholder="All customers" onChange={(o) => set("customerId", o?.id ?? null)} /></div>}
      {supplier && <div className="w-56"><EntityPicker entity="suppliers" value={sp.get("supplierId")} placeholder="All suppliers" onChange={(o) => set("supplierId", o?.id ?? null)} /></div>}
      {days && <select aria-label="Days" className="input w-auto" value={sp.get("days") ?? "90"} onChange={(e) => set("days", e.target.value)}>{[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}</select>}
    </>
  );
}
