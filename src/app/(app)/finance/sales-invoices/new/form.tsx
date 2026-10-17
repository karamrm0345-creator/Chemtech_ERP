"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSalesInvoiceAction } from "@/app/actions/finance";
import { useAction } from "@/components/forms/use-action";
import { Field, FormActions } from "@/components/forms/fields";
import { btn, Card } from "@/components/ui/primitives";
import { fmtAmount } from "@/lib/format";

type L = { id: string; lineNo: number; description: string; invoiceable: number; unitPrice: string; discountPct: string; taxRate: string };

export function InvoiceForm({ salesOrderId, currency, lines, date }: { salesOrderId: string; currency: string; lines: L[]; date: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ date, notes: "" });
  const [q, setQ] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(l.invoiceable)])));
  const net = (l: L) => Number(q[l.id] || 0) * Number(l.unitPrice) * (1 - Number(l.discountPct) / 100);
  const total = lines.reduce((s, l) => s + net(l) * (1 + Number(l.taxRate) / 100), 0);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      await run(() => createSalesInvoiceAction({ salesOrderId, ...h, lines: Object.entries(q).filter(([, v]) => Number(v) > 0).map(([salesOrderLineId, quantity]) => ({ salesOrderLineId, quantity })) }), { redirect: (d) => `/finance/sales-invoices/${(d as { id: string }).id}` });
    }}>
      <Card><div className="grid gap-4 sm:grid-cols-3"><Field label="Invoice date"><input type="date" className="input" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} /></Field><Field label="Notes" className="sm:col-span-2"><input className="input" value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field></div></Card>
      <Card bodyClass="p-0">
        <table className="table-base">
          <thead><tr><th>#</th><th>Description</th><th className="text-right">Invoiceable</th><th className="w-28 text-right">Invoice qty</th><th className="text-right">Unit price</th><th className="text-right">Net</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.id}><td>{l.lineNo}</td><td>{l.description}</td><td className="num">{l.invoiceable}</td><td><input className="input text-right" value={q[l.id]} onChange={(e) => setQ({ ...q, [l.id]: e.target.value })} /></td><td className="num">{fmtAmount(l.unitPrice)}</td><td className="num">{fmtAmount(net(l))}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5} className="text-right font-bold">Total incl. tax</td><td className="num font-bold">{currency} {fmtAmount(total)}</td></tr></tfoot>
        </table>
      </Card>
      <FormActions><button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button><button className={btn("action")} disabled={pending}>Create draft invoice</button></FormActions>
    </form>
  );
}
