"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCustomerReturnAction } from "@/app/actions/finance";
import { useAction } from "@/components/forms/use-action";
import { Field, FormActions } from "@/components/forms/fields";
import { btn, Card } from "@/components/ui/primitives";

type L = { id: string; description: string; returnable: number; batches: string[]; serialTracked: boolean; serials: string[] };

export function ReturnForm({ deliveryId, lines, today }: { deliveryId: string; lines: L[]; today: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ reason: "", date: today });
  const [v, setV] = useState<Record<string, { quantity: string; batchNo: string; serialNos: string }>>(Object.fromEntries(lines.map((l) => [l.id, { quantity: "", batchNo: l.batches.length === 1 ? l.batches[0] : "", serialNos: "" }])));
  const set = (id: string, patch: Partial<{ quantity: string; batchNo: string; serialNos: string }>) => setV({ ...v, [id]: { ...v[id], ...patch } });
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const chosen = lines.filter((l) => Number(v[l.id].quantity) > 0).map((l) => ({ deliveryLineId: l.id, ...v[l.id] }));
      await run(() => createCustomerReturnAction({ deliveryId, ...h, lines: chosen }), { redirect: (d) => `/sales/returns/${(d as { id: string }).id}` });
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Reason for return" required className="sm:col-span-2"><input className="input" required maxLength={1000} value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} placeholder="e.g. 2 drums damaged in transit" /></Field>
          <Field label="Date received"><input type="date" className="input" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} /></Field>
        </div>
      </Card>
      <Card bodyClass="p-0">
        <table className="table-base">
          <thead><tr><th>Description</th><th className="text-right">Can be returned</th><th className="w-28 text-right">Return qty</th><th>Batch</th><th>Serial numbers</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}>
              <td>{l.description}</td><td className="num">{l.returnable}</td>
              <td><input className="input text-right" inputMode="decimal" value={v[l.id].quantity} onChange={(e) => set(l.id, { quantity: e.target.value })} aria-label={`Return quantity for ${l.description}`} /></td>
              <td>{l.batches.length > 1 ? <select className="input" value={v[l.id].batchNo} onChange={(e) => set(l.id, { batchNo: e.target.value })} aria-label="Batch"><option value="">Select…</option>{l.batches.map((b) => <option key={b}>{b}</option>)}</select> : l.batches[0] ?? "—"}</td>
              <td>{l.serialTracked ? <input className="input" placeholder={l.serials.slice(0, 3).join(", ")} value={v[l.id].serialNos} onChange={(e) => set(l.id, { serialNos: e.target.value })} aria-label="Serial numbers" /> : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      <p className="text-sm text-ink-soft">Returned goods go back into stock at the cost they were delivered at. Issue a credit note from the invoice if the customer is to be credited.</p>
      <FormActions><button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button><button className={btn("action")} disabled={pending}>Receive return</button></FormActions>
    </form>
  );
}
