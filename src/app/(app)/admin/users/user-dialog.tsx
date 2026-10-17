"use client";
import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { saveUserAction } from "@/app/actions/admin";
import { useAction } from "@/components/forms/use-action";
import { Field, Select, Check } from "@/components/forms/fields";
import { Dialog } from "@/components/ui/dialog";
import { btn } from "@/components/ui/primitives";

type U = { id: string; name: string; email: string; phone: string; department: string; roleId: string; active: boolean };

export function UserDialog({ roles, user }: { roles: { value: string; label: string }[]; user?: U }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState({ name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "", department: user?.department ?? "", roleId: user?.roleId ?? "", password: "" });
  const [active, setActive] = useState(user?.active ?? true);
  const { run, pending } = useAction();
  return (
    <>
      {user
        ? <button className={btn("ghost", "py-1 text-xs")} onClick={() => setOpen(true)}><Pencil className="h-3.5 w-3.5" /> Edit</button>
        : <button className={btn("action")} onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New user</button>}
      <Dialog open={open} onClose={() => setOpen(false)} title={user ? `Edit ${user.name}` : "New user"}>
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => saveUserAction(user?.id ?? null, { ...s, active }))) setOpen(false);
        }}>
          <Field label="Full name" required><input className="input" required value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
          <Field label="Email" required><input className="input" type="email" required value={s.email} onChange={(e) => setS({ ...s, email: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><input className="input" value={s.phone} onChange={(e) => setS({ ...s, phone: e.target.value })} /></Field>
            <Field label="Department"><input className="input" value={s.department} onChange={(e) => setS({ ...s, department: e.target.value })} /></Field>
          </div>
          <Field label="Role" required><Select required value={s.roleId} onChange={(v) => setS({ ...s, roleId: v })} options={roles} placeholder="Select role" /></Field>
          <Field label={user ? "Reset password" : "Initial password"} required={!user} hint="Min 10 characters with letters and numbers. Share it securely; the user should change it after first sign-in.">
            <input className="input" type="password" autoComplete="new-password" required={!user} value={s.password} onChange={(e) => setS({ ...s, password: e.target.value })} />
          </Field>
          <Check label="Active" checked={active} onChange={setActive} />
          <div className="flex justify-end gap-2 pt-2"><button type="button" className={btn("outline")} onClick={() => setOpen(false)}>Cancel</button><button className={btn("primary")} disabled={pending}>Save</button></div>
        </form>
      </Dialog>
    </>
  );
}
