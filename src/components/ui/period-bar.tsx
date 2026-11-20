"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Select } from "@/components/forms/fields";

/** Date (range or as-of) and select filters kept in the URL, for financial statements. */
export function PeriodBar({ mode = "range", defaults, selects = [] }: {
  mode?: "range" | "asOf";
  defaults: { from?: string; to?: string; asOf?: string };
  selects?: { name: string; label: string; options: { value: string; label: string }[] }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const push = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    start(() => router.replace(`${pathname}?${p}`, { scroll: false }));
  };
  const date = (name: "from" | "to" | "asOf", label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-ink-soft">{label}</span>
      <input type="date" aria-label={label} className="input w-auto" value={sp.get(name) ?? defaults[name] ?? ""} onChange={(e) => push({ [name]: e.target.value })} />
    </label>
  );
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-3">
      {selects.map((s) => (
        <div key={s.name} className="min-w-[16rem]">
          <Select value={sp.get(s.name) ?? ""} onChange={(v) => push({ [s.name]: v })} options={s.options} placeholder={s.label} />
        </div>
      ))}
      {mode === "range" ? <>{date("from", "From")}{date("to", "To")}</> : date("asOf", "As of")}
      {pending && <Loader2 className="h-4 w-4 animate-spin text-ink-soft" />}
    </div>
  );
}
