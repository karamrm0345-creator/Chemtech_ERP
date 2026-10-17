"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { savePrAction } from "@/app/actions/purchasing";
import { useAction } from "@/components/forms/use-action";
import { Field, FormActions } from "@/components/forms/fields";
import { EntityPicker } from "@/components/forms/entity-picker";
import { btn, Card } from "@/components/ui/primitives";
import { fmtAmount } from "@/lib/format";

export type PrLine = { key: string; itemId: string | null; itemLabel?: string; description: string; quantity: string; uom: string; estimatedUnitPrice: string; requiredDate: string };
export const blankPrLine = (): PrLine => ({ key: Math.random().toString(36).slice(2), itemId: null, description: "", quantity: "1", uom: "", estimatedUnitPrice: "0", requiredDate: "" });

export function PrForm({ id, initial }: { id: string | null; initial: { department: string; costCenter: string; requiredDate: string; justification: string; lines: PrLine[] } }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ department: initial.department, costCenter: initial.costCenter, requiredDate: initial.requiredDate, justification: initial.justification });
  const [lines, setLines] = useState(initial.lines.length ? initial.lines : [blankPrLine()]);
  const set = (i: number, p: Partial<PrLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.estimatedUnitPrice || 0), 0);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      await run(() => savePrAction(id, { ...h, lines: lines.map(({ key: _k, itemLabel: _l, ...l }) => l) }), { redirect: (d) => `/purchasing/requests/${(d as { id: string }).id}` });
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Requesting department"><input className="input" value={h.department} onChange={(e) => setH({ ...h, department: e.target.value })} /></Field>
          <Field label="Project / cost centre"><input className="input" value={h.costCenter} onChange={(e) => setH({ ...h, costCenter: e.target.value })} /></Field>
          <Field label="Required delivery date"><input type="date" className="input" value={h.requiredDate} onChange={(e) => setH({ ...h, requiredDate: e.target.value })} /></Field>
          <Field label="Business justification" required className="sm:col-span-3"><textarea className="input" rows={2} required value={h.justification} onChange={(e) => setH({ ...h, justification: e.target.value })} /></Field>
        </div>
      </Card>
      <Card title="Requested items & services" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table-base min-w-[860px]">
            <thead><tr><th className="w-[260px]">Item</th><th>Description</th><th className="w-24 text-right">Qty</th><th className="w-20">UoM</th><th className="w-28 text-right">Est. unit price</th><th className="w-36">Required by</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td><EntityPicker entity="items" value={l.itemId} initialLabel={l.itemLabel} placeholder="Item (optional)" onChange={(o) => set(i, o ? { itemId: o.id, itemLabel: o.label, description: l.description || String(o.data?.name ?? ""), uom: String(o.data?.uom ?? ""), estimatedUnitPrice: String(o.data?.purchasePrice ?? "0") } : { itemId: null })} /></td>
                  <td><input className="input" required value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                  <td><input className="input text-right" required inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
                  <td><input className="input" value={l.uom} onChange={(e) => set(i, { uom: e.target.value })} /></td>
                  <td><input className="input text-right" inputMode="decimal" value={l.estimatedUnitPrice} onChange={(e) => set(i, { estimatedUnitPrice: e.target.value })} /></td>
                  <td><input type="date" className="input" value={l.requiredDate} onChange={(e) => set(i, { requiredDate: e.target.value })} /></td>
                  <td><button type="button" aria-label="Remove" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="p-1 text-ink-muted hover:text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between p-3">
          <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600" onClick={() => setLines([...lines, blankPrLine()])}><Plus className="h-4 w-4" /> Add line</button>
          <span className="text-sm">Estimated total: <b>QAR {fmtAmount(total)}</b></span>
        </div>
      </Card>
      <FormActions>
        <button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button>
        <button className={btn("action")} disabled={pending}>Save request as draft</button>
      </FormActions>
    </form>
  );
}
