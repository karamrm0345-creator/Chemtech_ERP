"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useAction, type Result } from "./use-action";
import { Field, Select } from "./fields";
import { btn } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";

/** Generic "open dialog → fill fields → call action" button. */
export function QuickFormButton({ label, title, fields, action, variant = "outline", initial = {}, redirectBase, note }: {
  label: string; title: string; variant?: "outline" | "primary" | "action";
  fields: { name: string; label: string; type?: "text" | "date" | "number" | "textarea" | "select"; required?: boolean; options?: { value: string; label: string }[] }[];
  action: (data: Record<string, string>) => Promise<Result<unknown>>;
  initial?: Record<string, string>;
  redirectBase?: string;
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<Record<string, string>>(initial);
  const { run, pending } = useAction();
  return (
    <>
      <button type="button" className={btn(variant, variant === "outline" ? "py-1.5 text-xs" : "")} onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> {label}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => action(s), { redirect: redirectBase ? (d) => ((d as { id?: string })?.id ? `${redirectBase}/${(d as { id: string }).id}` : undefined) : undefined })) { setOpen(false); setS(initial); } }}>
          {note && <p className="text-sm text-ink-soft">{note}</p>}
          {fields.map((f) => (
            <Field key={f.name} label={f.label} required={f.required}>
              {f.type === "textarea" ? <textarea className="input" rows={3} required={f.required} value={s[f.name] ?? ""} onChange={(e) => setS({ ...s, [f.name]: e.target.value })} />
                : f.type === "select" ? <Select value={s[f.name] ?? ""} onChange={(v) => setS({ ...s, [f.name]: v })} options={f.options ?? []} required={f.required} placeholder="Select…" />
                : <input className="input" type={f.type ?? "text"} required={f.required} value={s[f.name] ?? ""} onChange={(e) => setS({ ...s, [f.name]: e.target.value })} />}
            </Field>
          ))}
          <div className="flex justify-end gap-2"><button type="button" className={btn("outline")} onClick={() => setOpen(false)}>Cancel</button><button className={btn("primary")} disabled={pending}>Save</button></div>
        </form>
      </Dialog>
    </>
  );
}
