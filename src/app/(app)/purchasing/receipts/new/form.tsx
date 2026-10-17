"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createGrnAction } from "@/app/actions/purchasing";
import { useAction } from "@/components/forms/use-action";
import { Field, FormActions } from "@/components/forms/fields";
import { btn, Card } from "@/components/ui/primitives";

type L = { id: string; lineNo: number; code: string; description: string; uom: string; ordered: number; outstanding: number; batch: boolean; expiry: boolean; serial: boolean; stocked: boolean; defaultLocationId: string };
type V = { receivedQty: string; rejectedQty: string; rejectionReason: string; batchNo: string; expiryDate: string; certificateNo: string; serialNos: string; locationId: string };

export function GrnForm({ purchaseOrderId, lines, date, locations }: { purchaseOrderId: string; lines: L[]; date: string; locations: { value: string; label: string }[] }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ date, supplierDeliveryNote: "", notes: "" });
  const [v, setV] = useState<Record<string, V>>(Object.fromEntries(lines.map((l) => [l.id, { receivedQty: String(l.outstanding), rejectedQty: "0", rejectionReason: "", batchNo: "", expiryDate: "", certificateNo: "", serialNos: "", locationId: l.defaultLocationId }])));
  const set = (id: string, p: Partial<V>) => setV({ ...v, [id]: { ...v[id], ...p } });
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const payload = { purchaseOrderId, ...h, lines: Object.entries(v).filter(([, x]) => Number(x.receivedQty) > 0).map(([poLineId, x]) => ({ poLineId, ...x })) };
      await run(() => createGrnAction(payload), { redirect: (d) => `/purchasing/receipts/${(d as { id: string }).id}` });
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Receipt date"><input type="date" className="input" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} /></Field>
          <Field label="Supplier delivery note no."><input className="input" value={h.supplierDeliveryNote} onChange={(e) => setH({ ...h, supplierDeliveryNote: e.target.value })} /></Field>
          <Field label="Notes / inspection remarks"><input className="input" value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
        </div>
      </Card>
      <Card title="Received quantities & traceability" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table-base min-w-[1200px]">
            <thead><tr><th>#</th><th>Item</th><th className="text-right">Outstanding</th><th className="w-24 text-right">Received</th><th className="w-24 text-right">Rejected</th><th>Rejection reason</th><th>Batch / lot</th><th>Expiry</th><th>Certificate no.</th><th>Serial numbers</th><th>Bin</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const x = v[l.id];
                return (
                  <tr key={l.id}>
                    <td>{l.lineNo}</td>
                    <td className="min-w-[200px]"><span className="mr-1 font-mono text-xs text-ink-muted">{l.code}</span>{l.description}{!l.stocked && <div className="text-xs text-ink-muted">Service / non-stock: no stock movement</div>}</td>
                    <td className="num">{l.outstanding} {l.uom}</td>
                    <td><input className="input text-right" inputMode="decimal" value={x.receivedQty} onChange={(e) => set(l.id, { receivedQty: e.target.value })} /></td>
                    <td><input className="input text-right" inputMode="decimal" value={x.rejectedQty} onChange={(e) => set(l.id, { rejectedQty: e.target.value })} /></td>
                    <td><input className="input" disabled={!Number(x.rejectedQty)} value={x.rejectionReason} onChange={(e) => set(l.id, { rejectionReason: e.target.value })} /></td>
                    <td><input className="input" disabled={!l.batch} placeholder={l.batch ? "Required" : "n/a"} value={x.batchNo} onChange={(e) => set(l.id, { batchNo: e.target.value })} /></td>
                    <td><input type="date" className="input" disabled={!l.expiry} value={x.expiryDate} onChange={(e) => set(l.id, { expiryDate: e.target.value })} /></td>
                    <td><input className="input" disabled={!l.stocked} value={x.certificateNo} onChange={(e) => set(l.id, { certificateNo: e.target.value })} /></td>
                    <td><input className="input" disabled={!l.serial} placeholder={l.serial ? "SN1, SN2…" : "n/a"} value={x.serialNos} onChange={(e) => set(l.id, { serialNos: e.target.value })} /></td>
                    <td><select className="input" disabled={!l.stocked || !locations.length} value={x.locationId} onChange={(e) => set(l.id, { locationId: e.target.value })}><option value="">—</option>{locations.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <FormActions>
        <button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button>
        <button className={btn("action")} disabled={pending}>Create draft receipt</button>
      </FormActions>
    </form>
  );
}
