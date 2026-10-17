"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { purchaseReturnAction } from "@/app/actions/purchasing";
import { useAction } from "@/components/forms/use-action";
import { Field, Select, FormActions } from "@/components/forms/fields";
import { btn, Card, Notice } from "@/components/ui/primitives";

type L = { id: string; lineNo: number; description: string; code: string; returnable: number; batch: boolean; serial: boolean };

export function ReturnForm({ purchaseOrderId, receipts, lines }: { purchaseOrderId: string; receipts: { value: string; label: string }[]; lines: L[] }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ goodsReceiptId: receipts[0]?.value ?? "", reason: "" });
  const [v, setV] = useState<Record<string, { quantity: string; batchNo: string; serialNos: string }>>(Object.fromEntries(lines.map((l) => [l.id, { quantity: "", batchNo: "", serialNos: "" }])));
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      await run(() => purchaseReturnAction({ purchaseOrderId, ...h, lines: Object.entries(v).filter(([, x]) => Number(x.quantity) > 0).map(([poLineId, x]) => ({ poLineId, ...x })) }), { redirect: (d) => `/purchasing/returns/${(d as { id: string }).id}` });
    }}>
      <Notice tone="warning">The return is posted immediately: stock is removed from the warehouse and the quantity becomes outstanding again on the purchase order.</Notice>
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Goods receipt"><Select value={h.goodsReceiptId} onChange={(x) => setH({ ...h, goodsReceiptId: x })} options={receipts} placeholder="—" /></Field>
          <Field label="Reason" required className="sm:col-span-2"><input className="input" required value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} /></Field>
        </div>
      </Card>
      <Card bodyClass="p-0">
        <table className="table-base">
          <thead><tr><th>#</th><th>Item</th><th className="text-right">Returnable</th><th className="w-28 text-right">Return qty</th><th>Batch</th><th>Serials</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.lineNo}</td><td><span className="mr-1 font-mono text-xs text-ink-muted">{l.code}</span>{l.description}</td><td className="num">{l.returnable}</td>
                <td><input className="input text-right" value={v[l.id].quantity} onChange={(e) => setV({ ...v, [l.id]: { ...v[l.id], quantity: e.target.value } })} /></td>
                <td><input className="input" disabled={!l.batch} placeholder={l.batch ? "Auto FEFO" : "n/a"} value={v[l.id].batchNo} onChange={(e) => setV({ ...v, [l.id]: { ...v[l.id], batchNo: e.target.value } })} /></td>
                <td><input className="input" disabled={!l.serial} value={v[l.id].serialNos} onChange={(e) => setV({ ...v, [l.id]: { ...v[l.id], serialNos: e.target.value } })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <FormActions>
        <button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button>
        <button className={btn("danger")} disabled={pending}>Post return</button>
      </FormActions>
    </form>
  );
}
