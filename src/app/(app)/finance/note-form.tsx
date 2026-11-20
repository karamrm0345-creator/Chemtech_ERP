"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createCreditNoteAction, createDebitNoteAction } from "@/app/actions/finance";
import { useAction } from "@/components/forms/use-action";
import { Field, FormActions, Select } from "@/components/forms/fields";
import { btn, Card } from "@/components/ui/primitives";
import { fmtAmount } from "@/lib/format";

type Line = { id: string; description: string; open: string; unitPrice: string; discountPct: string; taxRate: string; poLineId?: string | null };
type Ret = { id: string; label: string; lines: { id: string; poLineId: string; open: string }[] };
const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Credit note (sales) or debit note (purchases) against one posted invoice. */
export function NoteForm({ kind, invoiceId, currency, lines, today, returns = [], returnId, initialQty = {} }: {
  kind: "credit" | "debit"; invoiceId: string; currency: string; lines: Line[]; today: string;
  returns?: Ret[]; returnId?: string; initialQty?: Record<string, string>;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ reason: "", date: today, supplierRef: "", purchaseReturnId: returnId ?? "" });
  const [v, setV] = useState<Record<string, { quantity: string; unitPrice: string }>>(() => {
    const r = returns.find((x) => x.id === returnId);
    return Object.fromEntries(lines.map((l) => {
      const rl = r?.lines.find((x) => x.poLineId === l.poLineId);
      return [l.id, { quantity: initialQty[l.id] ?? (rl ? String(Math.min(n(rl.open), n(l.open))) : ""), unitPrice: l.unitPrice }];
    }));
  });
  const ret = returns.find((r) => r.id === h.purchaseReturnId);
  const returnLine = (l: Line) => ret?.lines.find((r) => r.poLineId === l.poLineId);
  const pickReturn = (id: string) => {
    setH({ ...h, purchaseReturnId: id });
    const r = returns.find((x) => x.id === id);
    if (r) setV(Object.fromEntries(lines.map((l) => { const rl = r.lines.find((x) => x.poLineId === l.poLineId); return [l.id, { quantity: rl ? String(Math.min(n(rl.open), n(l.open))) : "", unitPrice: l.unitPrice }]; })));
  };
  const net = (l: Line) => n(v[l.id].quantity) * n(v[l.id].unitPrice) * (1 - n(l.discountPct) / 100);
  const total = useMemo(() => lines.reduce((s, l) => s + net(l) * (1 + n(l.taxRate) / 100), 0), [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const chosen = lines.filter((l) => n(v[l.id].quantity) > 0);
      const base = kind === "credit" ? "/finance/credit-notes" : "/finance/debit-notes";
      const payload = kind === "credit"
        ? { invoiceId, reason: h.reason, date: h.date, customerReturnId: returnId, lines: chosen.map((l) => ({ invoiceLineId: l.id, ...v[l.id] })) }
        : { invoiceId, reason: h.reason, date: h.date, supplierRef: h.supplierRef, purchaseReturnId: h.purchaseReturnId || undefined, lines: chosen.map((l) => ({ invoiceLineId: l.id, ...v[l.id], returnLineId: returnLine(l)?.id })) };
      await run(() => (kind === "credit" ? createCreditNoteAction(payload) : createDebitNoteAction(payload)), { redirect: (d) => `${base}/${(d as { id: string }).id}` });
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Reason" required className="lg:col-span-2"><input className="input" required maxLength={1000} value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} placeholder={kind === "credit" ? "e.g. 2 drums returned damaged" : "e.g. returned off-spec material"} /></Field>
          <Field label="Date"><input type="date" className="input" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} /></Field>
          {kind === "debit" && <Field label="Supplier credit note no."><input className="input" maxLength={60} value={h.supplierRef} onChange={(e) => setH({ ...h, supplierRef: e.target.value })} /></Field>}
          {kind === "debit" && returns.length > 0 && <Field label="For goods returned on" hint="Links the note to the return so the stock value is cleared exactly" className="lg:col-span-2">
            <Select value={h.purchaseReturnId} onChange={pickReturn} options={returns.map((r) => ({ value: r.id, label: r.label }))} placeholder="— Price allowance only —" /></Field>}
        </div>
      </Card>
      <Card bodyClass="p-0">
        <table className="table-base">
          <thead><tr><th>Description</th><th className="text-right">Can still be {kind === "credit" ? "credited" : "debited"}</th>{kind === "debit" && ret && <th className="text-right">Returned, not debited</th>}<th className="w-28 text-right">Quantity</th><th className="w-32 text-right">Unit price ({currency})</th><th className="text-right">Tax %</th><th className="text-right">Net</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}>
              <td>{l.description}</td><td className="num">{l.open}</td>
              {kind === "debit" && ret && <td className="num">{returnLine(l)?.open ?? "—"}</td>}
              <td><input className="input text-right" inputMode="decimal" value={v[l.id].quantity} onChange={(e) => setV({ ...v, [l.id]: { ...v[l.id], quantity: e.target.value } })} aria-label={`Quantity for ${l.description}`} /></td>
              <td><input className="input text-right" inputMode="decimal" value={v[l.id].unitPrice} onChange={(e) => setV({ ...v, [l.id]: { ...v[l.id], unitPrice: e.target.value } })} aria-label={`Unit price for ${l.description}`} /></td>
              <td className="num">{l.taxRate}</td><td className="num">{fmtAmount(net(l))}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={kind === "debit" && ret ? 6 : 5} className="text-right font-bold">Total incl. tax</td><td className="num font-bold">{currency} {fmtAmount(total)}</td></tr></tfoot>
        </table>
      </Card>
      <p className="text-sm text-ink-soft">Lower the unit price for a price allowance; keep the invoiced price for returned goods. The price cannot exceed the invoiced price.</p>
      <FormActions><button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button><button className={btn("action")} disabled={pending || total <= 0}>Save draft {kind} note</button></FormActions>
    </form>
  );
}
