"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useAction, type Result } from "./use-action";
import { Check } from "./fields";
import { btn } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";

export function AddContactButton({ action }: { action: (data: unknown) => Promise<Result<unknown>> }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState({ name: "", title: "", department: "", email: "", phone: "" });
  const [primary, setPrimary] = useState(false);
  const { run, pending } = useAction();
  return (
    <>
      <button type="button" className={btn("outline", "py-1.5 text-xs")} onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Add contact</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add contact">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => action({ ...s, isPrimary: primary }))) { setOpen(false); setS({ name: "", title: "", department: "", email: "", phone: "" }); }
        }}>
          {(["name", "title", "department", "email", "phone"] as const).map((k) => (
            <label key={k} className="block"><span className="label">{k}{k === "name" && " *"}</span>
              <input className="input" required={k === "name"} type={k === "email" ? "email" : "text"} value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></label>
          ))}
          <Check label="Primary contact" checked={primary} onChange={setPrimary} />
          <div className="flex justify-end gap-2"><button type="button" className={btn("outline")} onClick={() => setOpen(false)}>Cancel</button><button className={btn("primary")} disabled={pending}>Save</button></div>
        </form>
      </Dialog>
    </>
  );
}
