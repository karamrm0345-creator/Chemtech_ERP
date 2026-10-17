"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X } from "lucide-react";
import { createRfqAction } from "@/app/actions/purchasing";
import { useAction } from "@/components/forms/use-action";
import { Field, FormActions } from "@/components/forms/fields";
import { EntityPicker } from "@/components/forms/entity-picker";
import { btn, Card } from "@/components/ui/primitives";

type L = { key: string; prLineId?: string | null; itemId: string | null; itemLabel?: string; description: string; quantity: string; uom: string };
const blank = (): L => ({ key: Math.random().toString(36).slice(2), itemId: null, description: "", quantity: "1", uom: "" });

export function RfqForm({ initial }: { initial: { title: string; purchaseRequestId: string; dueDate: string; notes: string; suppliers: { id: string; label: string }[]; lines: L[] } }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ title: initial.title, dueDate: initial.dueDate, notes: initial.notes });
  const [sups, setSups] = useState(initial.suppliers);
  const [lines, setLines] = useState(initial.lines.length ? initial.lines : [blank()]);
  const set = (i: number, p: Partial<L>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      await run(() => createRfqAction({ ...h, purchaseRequestId: initial.purchaseRequestId, supplierIds: sups.map((s) => s.id), lines: lines.map(({ key: _k, itemLabel: _l, ...l }) => l) }), { redirect: (d) => `/purchasing/rfqs/${(d as { id: string }).id}` });
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Title" required className="sm:col-span-2"><input className="input" required value={h.title} onChange={(e) => setH({ ...h, title: e.target.value })} /></Field>
          <Field label="Offers due by"><input type="date" className="input" value={h.dueDate} onChange={(e) => setH({ ...h, dueDate: e.target.value })} /></Field>
          <Field label="Notes / technical requirements" className="sm:col-span-3"><textarea className="input" rows={2} value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
        </div>
      </Card>
      <Card title="Invited suppliers">
        <div className="mb-3 flex flex-wrap gap-2">
          {sups.map((s) => <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">{s.label}<button type="button" aria-label="Remove" onClick={() => setSups(sups.filter((x) => x.id !== s.id))}><X className="h-3.5 w-3.5" /></button></span>)}
          {!sups.length && <span className="text-sm text-ink-muted">Add at least one supplier.</span>}
        </div>
        <div className="max-w-md"><EntityPicker entity="suppliers" value={null} placeholder="Add supplier…" onChange={(o) => o && !sups.some((s) => s.id === o.id) && setSups([...sups, { id: o.id, label: o.label }])} /></div>
      </Card>
      <Card title="Items requested" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table-base min-w-[720px]">
            <thead><tr><th className="w-[260px]">Item</th><th>Description / specification</th><th className="w-24 text-right">Qty</th><th className="w-20">UoM</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td><EntityPicker entity="items" value={l.itemId} initialLabel={l.itemLabel} placeholder="Item (optional)" onChange={(o) => set(i, o ? { itemId: o.id, itemLabel: o.label, description: l.description || String(o.data?.name ?? ""), uom: String(o.data?.uom ?? "") } : { itemId: null })} /></td>
                  <td><input className="input" required value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                  <td><input className="input text-right" required value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
                  <td><input className="input" value={l.uom} onChange={(e) => set(i, { uom: e.target.value })} /></td>
                  <td><button type="button" aria-label="Remove" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="p-1 text-ink-muted hover:text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3"><button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600" onClick={() => setLines([...lines, blank()])}><Plus className="h-4 w-4" /> Add line</button></div>
      </Card>
      <FormActions>
        <button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button>
        <button className={btn("action")} disabled={pending || !sups.length}>Create RFQ</button>
      </FormActions>
    </form>
  );
}
