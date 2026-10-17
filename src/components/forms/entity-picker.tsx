"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Loader2, X } from "lucide-react";

export interface Option { id: string; label: string; sub?: string; data?: Record<string, unknown> }

/** Async searchable picker backed by /api/lookup/<entity>. */
export function EntityPicker({
  entity, value, onChange, placeholder = "Search…", disabled, initialLabel, params,
}: {
  entity: "items" | "customers" | "suppliers" | "users";
  value: string | null;
  onChange: (opt: Option | null) => void;
  placeholder?: string;
  disabled?: boolean;
  initialLabel?: string;
  params?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState(initialLabel ?? "");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setLabel(initialLabel ?? ""), [initialLabel]);
  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ q, ...(params ?? {}) });
        const r = await fetch(`/api/lookup/${entity}?${qs}`, { signal: ctl.signal });
        if (r.ok) setOpts(await r.json());
      } catch { /* aborted */ } finally { setLoading(false); }
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, entity]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div className="relative" ref={box}>
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)} className="input flex items-center justify-between gap-2 text-left">
        <span className={value ? "truncate" : "truncate text-ink-muted"}>{value ? label || "Selected" : placeholder}</span>
        <span className="flex items-center gap-1">
          {value && !disabled && <X className="h-4 w-4 text-ink-muted hover:text-ink" onClick={(e) => { e.stopPropagation(); onChange(null); setLabel(""); }} />}
          <ChevronsUpDown className="h-4 w-4 text-ink-muted" />
        </span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[260px] rounded-md border border-line bg-white shadow-lg">
          <div className="border-b border-line p-2">
            <input autoFocus className="input" placeholder="Type to search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1 text-sm">
            {loading && <li className="flex items-center gap-2 px-3 py-2 text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</li>}
            {!loading && opts.length === 0 && <li className="px-3 py-2 text-ink-muted">No matches</li>}
            {!loading && opts.map((o) => (
              <li key={o.id}>
                <button type="button" className="block w-full px-3 py-2 text-left hover:bg-brand-50" onClick={() => { onChange(o); setLabel(o.label); setOpen(false); setQ(""); }}>
                  <span className="block font-medium">{o.label}</span>
                  {o.sub && <span className="block text-xs text-ink-muted">{o.sub}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
