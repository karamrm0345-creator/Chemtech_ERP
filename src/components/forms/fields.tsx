"use client";
import { cn } from "@/lib/cn";

export function Field({ label, required, hint, children, className }: { label: string; required?: boolean; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="label">{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

type Opt = { value: string; label: string };

export function Select({ value, onChange, options, placeholder, required, disabled }: { value: string; onChange: (v: string) => void; options: Opt[]; placeholder?: string; required?: boolean; disabled?: boolean }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} required={required} disabled={disabled}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 py-1 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line text-brand-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="block text-xs text-ink-muted">{hint}</span>}</span>
    </label>
  );
}

/** Small helper: bind a state object field to an input. */
export function bind<T extends Record<string, unknown>>(state: T, set: (s: T) => void, key: keyof T) {
  return {
    value: (state[key] ?? "") as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set({ ...state, [key]: e.target.value }),
  };
}

export function FormActions({ children }: { children: React.ReactNode }) {
  return <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap justify-end gap-2 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-b-lg">{children}</div>;
}
