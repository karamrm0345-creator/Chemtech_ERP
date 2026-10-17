"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseInvoiceAction } from "@/app/actions/finance";
import { useAction } from "@/components/forms/use-action";
import { Field, FormActions } from "@/components/forms/fields";
import { btn, Card } from "@/components/ui/primitives";

type L = { id: string; lineNo: number; description: string; open: number; poUnit: string; taxRate: string };

export function PiForm({ purchaseOrderId, currency, lines, date }: { purchaseOrderId: string; currency: string; lines: L[]; date: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ supplierInvoiceNo: "", date, dueDate: "", notes: "" });
  const [v, setV] = useState<Record<string, { quantity: string; unitPrice: string }>>(Object.fromEntries(lines.map((l) => [l.id, { quantity: String(l.open), unitPrice: l.poUnit }])));
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      await run(() => createPurchaseInvoiceAction({ purchaseOrderId, ...h, lines: Object.entries(v).filter(([, x]) => Number(x.quantity) > 0).map(([poLineId, x]) => ({ poLineId, ...x })) }), { redirect: (d) => `/finance/purchase-invoices/${(d as { id: string }).id}` });
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Supplier invoice no." required><input className="input" required value={h.supplierInvoiceNo} onChange={(e) => setH({ ...h, supplierInvoiceNo: e.target.value })} /></Field>
          <Field label="Invoice date"><input type="date" className="input" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} /></Field>
          <Field label="Due date" hint="Blank = supplier payment terms"><input type="date" className="input" value={h.dueDate} onChange={(e) => setH({ ...h, dueDate: e.target.value })} /></Field>
          <Field label="Notes"><input className="input" value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
        </div>
      </Card>
      <Card bodyClass="p-0">
        <table className="table-base">
          <thead><tr><th>#</th><th>Description</th><th className="text-right">Received, not invoiced</th><th className="w-28 text-right">Invoice qty</th><th className="text-right">PO net unit</th><th className="w-32 text-right">Invoiced unit price ({currency})</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td>{l.lineNo}</td><td>{l.description}</td><td className="num">{l.open}</td>
              <td><input className="input text-right" value={v[l.id].quantity} onChange={(e) => setV({ ...v, [l.id]: { ...v[l.id], quantity: e.target.value } })} /></td>
              <td className="num">{l.poUnit}</td>
              <td><input className={`input text-right ${v[l.id].unitPrice !== l.poUnit ? "border-amber-400 bg-amber-50" : ""}`} value={v[l.id].unitPrice} onChange={(e) => setV({ ...v, [l.id]: { ...v[l.id], unitPrice: e.target.value } })} /></td></tr>
          ))}</tbody>
        </table>
      </Card>
      <FormActions><button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button><button className={btn("action")} disabled={pending}>Record invoice (draft)</button></FormActions>
    </form>
  );
}
