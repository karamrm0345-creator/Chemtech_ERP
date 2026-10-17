"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createStockDocAction } from "@/app/actions/inventory";
import { useAction } from "@/components/forms/use-action";
import { Field, Select, FormActions } from "@/components/forms/fields";
import { EntityPicker } from "@/components/forms/entity-picker";
import { btn, Card, Notice } from "@/components/ui/primitives";
import { humanize } from "@/lib/format";

type L = { key: string; itemId: string | null; label?: string; batch?: boolean; serial?: boolean; expiry?: boolean; quantity: string; unitCost: string; batchNo: string; expiryDate: string; serialNos: string };
const blank = (): L => ({ key: Math.random().toString(36).slice(2), itemId: null, quantity: "", unitCost: "", batchNo: "", expiryDate: "", serialNos: "" });

const HELP: Record<string, string> = {
  OPENING: "Initial stock balances. Requires approval by a different user with adjustment-approval rights (value limits apply).",
  ADJUSTMENT: "Corrections: positive quantity adds stock, negative removes it. Requires a reason and approval by a different user.",
  TRANSFER: "Moves stock between warehouses. Posted immediately by authorised store users; reserved stock cannot be transferred.",
  ISSUE: "Internal consumption (workshop, jobs, samples). Reserved stock cannot be issued.",
};

export function StockDocForm({ allowed, initialType, warehouses, initialItem }: {
  allowed: string[]; initialType: string; warehouses: { value: string; label: string }[];
  initialItem: { id: string; label: string; batch: boolean; serial: boolean; expiry: boolean; cost: string } | null;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ type: initialType, warehouseId: warehouses[0]?.value ?? "", toWarehouseId: "", reason: "", reference: "", costCenter: "" });
  const [lines, setLines] = useState<L[]>([initialItem ? { ...blank(), itemId: initialItem.id, label: initialItem.label, batch: initialItem.batch, serial: initialItem.serial, expiry: initialItem.expiry, unitCost: initialItem.cost } : blank()]);
  const set = (i: number, p: Partial<L>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const inbound = h.type === "OPENING" || h.type === "ADJUSTMENT";
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const payload = { ...h, lines: lines.filter((l) => l.itemId).map(({ itemId, quantity, unitCost, batchNo, expiryDate, serialNos }) => ({ itemId, quantity, unitCost, batchNo, expiryDate, serialNos })) };
      await run(() => createStockDocAction(payload), { redirect: (d) => `/inventory/documents/${(d as { id: string }).id}` });
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Document type" required><Select value={h.type} onChange={(v) => setH({ ...h, type: v })} options={allowed.map((t) => ({ value: t, label: humanize(t) }))} /></Field>
          <Field label={h.type === "TRANSFER" ? "From warehouse" : "Warehouse"} required><Select value={h.warehouseId} onChange={(v) => setH({ ...h, warehouseId: v })} options={warehouses} /></Field>
          {h.type === "TRANSFER" && <Field label="To warehouse" required><Select value={h.toWarehouseId} onChange={(v) => setH({ ...h, toWarehouseId: v })} options={warehouses.filter((w) => w.value !== h.warehouseId)} placeholder="Select" /></Field>}
          <Field label="Reference"><input className="input" value={h.reference} onChange={(e) => setH({ ...h, reference: e.target.value })} /></Field>
          {h.type === "ISSUE" && <Field label="Cost centre / job"><input className="input" value={h.costCenter} onChange={(e) => setH({ ...h, costCenter: e.target.value })} /></Field>}
          <Field label="Reason" required={h.type === "ADJUSTMENT"} className="sm:col-span-2 lg:col-span-4"><input className="input" required={h.type === "ADJUSTMENT"} value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} /></Field>
        </div>
        <div className="mt-3"><Notice>{HELP[h.type]}</Notice></div>
      </Card>
      <Card title="Lines" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table-base min-w-[900px]">
            <thead><tr><th className="w-[300px]">Item</th><th className="w-28 text-right">Quantity{h.type === "ADJUSTMENT" && " (±)"}</th>{inbound && <th className="w-28 text-right">Unit cost</th>}<th>Batch / lot</th>{inbound && <th>Expiry</th>}<th>Serial numbers</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td><EntityPicker entity="items" params={{ stock: "1" }} value={l.itemId} initialLabel={l.label}
                    onChange={(o) => set(i, o ? { itemId: o.id, label: o.label, batch: !!o.data?.batchTracked, serial: !!o.data?.serialTracked, expiry: !!o.data?.expiryTracked, unitCost: l.unitCost || String(o.data?.purchasePrice ?? "") } : { itemId: null })} /></td>
                  <td><input className="input text-right" required inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
                  {inbound && <td><input className="input text-right" inputMode="decimal" placeholder="avg" value={l.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} /></td>}
                  <td><input className="input" disabled={!l.batch} placeholder={l.batch ? (inbound ? "Required" : "Auto FEFO") : "n/a"} value={l.batchNo} onChange={(e) => set(i, { batchNo: e.target.value })} /></td>
                  {inbound && <td><input type="date" className="input" disabled={!l.expiry} value={l.expiryDate} onChange={(e) => set(i, { expiryDate: e.target.value })} /></td>}
                  <td><input className="input" disabled={!l.serial} placeholder={l.serial ? "SN1, SN2…" : "n/a"} value={l.serialNos} onChange={(e) => set(i, { serialNos: e.target.value })} /></td>
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
        <button className={btn("action")} disabled={pending}>Save as draft</button>
      </FormActions>
    </form>
  );
}
