"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDeliveryAction } from "@/app/actions/sales";
import { useAction } from "@/components/forms/use-action";
import { Field, FormActions } from "@/components/forms/fields";
import { btn, Card } from "@/components/ui/primitives";

type L = { id: string; lineNo: number; code: string; description: string; uom: string; open: number; batch: boolean; serial: boolean };

export function DeliveryForm({ salesOrderId, lines, defaults }: { salesOrderId: string; lines: L[]; defaults: { date: string; shippingAddress: string } }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ ...defaults, vehicleNo: "", driverName: "", notes: "" });
  const [q, setQ] = useState<Record<string, { quantity: string; batchNo: string; serialNos: string }>>(Object.fromEntries(lines.map((l) => [l.id, { quantity: String(l.open), batchNo: "", serialNos: "" }])));
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const payload = { salesOrderId, ...h, lines: Object.entries(q).filter(([, v]) => Number(v.quantity) > 0).map(([salesOrderLineId, v]) => ({ salesOrderLineId, ...v })) };
      await run(() => createDeliveryAction(payload), { redirect: (d) => `/sales/deliveries/${(d as { id: string }).id}` });
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Delivery date"><input type="date" className="input" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} /></Field>
          <Field label="Vehicle no."><input className="input" value={h.vehicleNo} onChange={(e) => setH({ ...h, vehicleNo: e.target.value })} /></Field>
          <Field label="Driver"><input className="input" value={h.driverName} onChange={(e) => setH({ ...h, driverName: e.target.value })} /></Field>
          <Field label="Shipping address" className="sm:col-span-2 lg:col-span-4"><input className="input" value={h.shippingAddress} onChange={(e) => setH({ ...h, shippingAddress: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-4"><input className="input" value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
        </div>
      </Card>
      <Card title="Quantities to deliver" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table-base min-w-[760px]">
            <thead><tr><th>#</th><th>Item</th><th className="text-right">Outstanding</th><th className="w-32 text-right">Deliver now</th><th>Batch (blank = FEFO)</th><th>Serial numbers</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.lineNo}</td><td><span className="mr-1 font-mono text-xs text-ink-muted">{l.code}</span>{l.description}</td>
                  <td className="num">{l.open} {l.uom}</td>
                  <td><input className="input text-right" inputMode="decimal" value={q[l.id].quantity} onChange={(e) => setQ({ ...q, [l.id]: { ...q[l.id], quantity: e.target.value } })} /></td>
                  <td><input className="input" disabled={!l.batch} placeholder={l.batch ? "Auto (first expiry first out)" : "n/a"} value={q[l.id].batchNo} onChange={(e) => setQ({ ...q, [l.id]: { ...q[l.id], batchNo: e.target.value } })} /></td>
                  <td><input className="input" disabled={!l.serial} placeholder={l.serial ? "SN1, SN2…" : "n/a"} value={q[l.id].serialNos} onChange={(e) => setQ({ ...q, [l.id]: { ...q[l.id], serialNos: e.target.value } })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <FormActions>
        <button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button>
        <button className={btn("action")} disabled={pending}>Create draft delivery</button>
      </FormActions>
    </form>
  );
}
