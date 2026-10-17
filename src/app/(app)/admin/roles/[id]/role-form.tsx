"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveRoleAction } from "@/app/actions/admin";
import { useAction } from "@/components/forms/use-action";
import { Field, FormActions } from "@/components/forms/fields";
import { btn, Card } from "@/components/ui/primitives";

const LIMIT_DOCS = [
  ["SALES_QUOTATION", "Sales quotations"], ["SALES_ORDER", "Sales orders"], ["PURCHASE_REQUEST", "Purchase requests"],
  ["PURCHASE_ORDER", "Purchase orders"], ["STOCK_ADJUSTMENT", "Stock adjustments & counts"],
] as const;

export function RoleForm({ id, groups, initial, isSystem }: {
  id: string | null; groups: Record<string, Record<string, string>>; isSystem: boolean;
  initial: { code: string; name: string; description: string; permissions: string[]; limits: Record<string, string> };
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [s, setS] = useState({ code: initial.code, name: initial.name, description: initial.description });
  const [perms, setPerms] = useState(new Set(initial.permissions));
  const [limits, setLimits] = useState<Record<string, string>>(initial.limits);
  const toggle = (p: string) => { const n = new Set(perms); if (n.has(p)) n.delete(p); else n.add(p); setPerms(n); };
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const lim = LIMIT_DOCS.filter(([d]) => limits[d] !== undefined && limits[d] !== "").map(([d]) => ({ docType: d, maxAmount: limits[d] === "unlimited" ? null : limits[d] }));
      const r = await run(() => saveRoleAction(id, { ...s, permissions: [...perms], limits: lim }), { redirect: () => "/admin/roles" });
      if (r) router.refresh();
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Role name" required><input className="input" required value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
          <Field label="Code" required hint={isSystem ? "System role codes cannot change" : "Upper-case identifier"}><input className="input font-mono" required disabled={isSystem} value={s.code} onChange={(e) => setS({ ...s, code: e.target.value })} /></Field>
          <Field label="Description"><input className="input" value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></Field>
        </div>
      </Card>
      <Card title="Permissions">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(groups).map(([g, items]) => (
            <fieldset key={g}>
              <legend className="mb-1 text-sm font-bold">{g}</legend>
              {Object.entries(items).map(([p, label]) => (
                <label key={p} className="flex cursor-pointer items-start gap-2 py-0.5 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={perms.has(p)} onChange={() => toggle(p)} />
                  <span>{label} <span className="font-mono text-[10px] text-ink-muted">{p}</span></span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </Card>
      <Card title="Approval limits (QAR, base currency)">
        <p className="mb-3 text-sm text-ink-soft">Applies only when the role also holds the matching approve permission. Leave blank for no cap, or enter <b>unlimited</b> explicitly. Approvers can never approve documents they prepared.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {LIMIT_DOCS.map(([d, label]) => (
            <Field key={d} label={label}><input className="input" placeholder="No cap" value={limits[d] ?? ""} onChange={(e) => setLimits({ ...limits, [d]: e.target.value })} /></Field>
          ))}
        </div>
      </Card>
      <FormActions>
        <button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button>
        <button className={btn("action")} disabled={pending}>Save role</button>
      </FormActions>
    </form>
  );
}
