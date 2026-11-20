"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { openInvoicesAction, receiptAction, supplierPaymentEntryAction } from "@/app/actions/finance";
import { useAction } from "@/components/forms/use-action";
import { Field, FormActions, Select } from "@/components/forms/fields";
import { EntityPicker, type Option } from "@/components/forms/entity-picker";
import { btn, Card, Notice } from "@/components/ui/primitives";
import { fmtAmount, fmtDate } from "@/lib/format";

type Inv = { id: string; number: string; ref: string; date: string; dueDate: string; currency: string; total: string; balance: string };
const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Receipt (customer) or payment (supplier) with allocation across open invoices; the rest stays on account. */
export function PaymentEntryForm({ side, baseCurrency, currencies, banks, today, preset }: {
  side: "customer" | "supplier";
  baseCurrency: string;
  currencies: { code: string; rate: string }[];
  banks: { options: { value: string; label: string }[]; defaultId: string };
  today: string;
  preset?: { partyId: string; partyLabel: string; currency: string; whtRate?: string };
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [party, setParty] = useState<{ id: string; label: string } | null>(preset ? { id: preset.partyId, label: preset.partyLabel } : null);
  const [h, setH] = useState({ date: today, amount: "", currency: preset?.currency ?? baseCurrency, exchangeRate: "", method: "BANK_TRANSFER", accountId: banks.defaultId, reference: "", whtRate: preset?.whtRate ?? "" });
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!party) { setInvoices([]); return; }
    let live = true;
    setLoading(true);
    openInvoicesAction(side, party.id).then((r) => { if (live) { setInvoices(r.ok ? (r.data as Inv[]) : []); setAlloc({}); setLoading(false); } });
    return () => { live = false; };
  }, [party, side]);

  const shown = invoices.filter((i) => i.currency === h.currency);
  const allocated = useMemo(() => r2(Object.values(alloc).reduce((s, v) => s + n(v), 0)), [alloc]);
  const amount = n(h.amount);
  const rest = r2(amount - allocated);
  const wht = side === "supplier" ? r2((amount * n(h.whtRate)) / 100) : 0;
  const autoAllocate = () => {
    let left = amount;
    const next: Record<string, string> = {};
    for (const i of shown) { if (left <= 0) break; const use = Math.min(left, n(i.balance)); next[i.id] = use.toFixed(2); left = r2(left - use); }
    setAlloc(next);
  };
  const isBase = h.currency === baseCurrency;

  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      if (!party) return;
      const payload = {
        [side === "customer" ? "customerId" : "supplierId"]: party.id, ...h, exchangeRate: isBase ? undefined : h.exchangeRate || undefined,
        whtRate: side === "supplier" ? h.whtRate : undefined,
        allocations: Object.entries(alloc).filter(([, v]) => n(v) > 0).map(([invoiceId, v]) => ({ invoiceId, amount: v })),
      };
      const base = side === "customer" ? "/finance/receipts" : "/finance/payments";
      await run(() => (side === "customer" ? receiptAction(payload) : supplierPaymentEntryAction(payload)), { redirect: (d) => `${base}/${(d as { id: string }).id}` });
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={side === "customer" ? "Customer" : "Supplier"} required className="lg:col-span-2">
            <EntityPicker entity={side === "customer" ? "customers" : "suppliers"} value={party?.id ?? null} initialLabel={party?.label}
              onChange={(o: Option | null) => { setParty(o ? { id: o.id, label: o.label } : null); const cur = (o?.data?.currency as string) || baseCurrency; const w = o?.data?.withholdingRate; setH((x) => ({ ...x, currency: cur, ...(side === "supplier" ? { whtRate: w != null ? String(w) : "0" } : {}) })); }} />
          </Field>
          <Field label="Date" required><input type="date" className="input" required value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} /></Field>
          <Field label={`Amount (${h.currency})`} required><input className="input text-right" inputMode="decimal" required value={h.amount} onChange={(e) => setH({ ...h, amount: e.target.value })} /></Field>
          <Field label="Currency"><Select value={h.currency} onChange={(v) => { setH({ ...h, currency: v, exchangeRate: "" }); setAlloc({}); }} options={currencies.map((c) => ({ value: c.code, label: c.code }))} /></Field>
          {!isBase && <Field label={`Rate (1 ${h.currency} = ? ${baseCurrency})`} hint={`Blank = ${currencies.find((c) => c.code === h.currency)?.rate ?? "table rate"}`}><input className="input text-right" inputMode="decimal" value={h.exchangeRate} onChange={(e) => setH({ ...h, exchangeRate: e.target.value })} /></Field>}
          <Field label="Method"><Select value={h.method} onChange={(v) => setH({ ...h, method: v })} options={["BANK_TRANSFER", "CHEQUE", "CASH", "CARD", "OTHER"].map((m) => ({ value: m, label: m.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))} /></Field>
          <Field label={side === "customer" ? "Received into" : "Paid from"} required><Select value={h.accountId} onChange={(v) => setH({ ...h, accountId: v })} options={banks.options} required /></Field>
          <Field label="Reference (bank ref / cheque no.)"><input className="input" value={h.reference} onChange={(e) => setH({ ...h, reference: e.target.value })} maxLength={100} /></Field>
          {side === "supplier" && <Field label="Withholding tax %" hint={wht ? `Withheld ${fmtAmount(wht)}; bank pays ${fmtAmount(r2(amount - wht))}` : "From the supplier record"}><input className="input text-right" inputMode="decimal" value={h.whtRate} onChange={(e) => setH({ ...h, whtRate: e.target.value })} /></Field>}
        </div>
      </Card>
      {party && (
        <Card title={`Allocate to open invoices (${h.currency})`} bodyClass="p-0" actions={shown.length > 0 && <button type="button" className={btn("outline", "py-1 text-xs")} onClick={autoAllocate}>Allocate oldest first</button>}>
          {loading ? <p className="px-4 py-3 text-sm text-ink-soft">Loading…</p> : shown.length === 0 ? <p className="px-4 py-3 text-sm text-ink-soft">No open invoices in {h.currency}. The full amount will be held on account as an advance.</p> : (
            <table className="table-base">
              <thead><tr><th>Invoice</th>{side === "supplier" && <th>Supplier ref.</th>}<th>Date</th><th>Due</th><th className="text-right">Total</th><th className="text-right">Open</th><th className="w-36 text-right">Allocate</th></tr></thead>
              <tbody>{shown.map((i) => (
                <tr key={i.id}>
                  <td>{i.number}</td>{side === "supplier" && <td>{i.ref}</td>}<td>{fmtDate(i.date)}</td>
                  <td className={new Date(i.dueDate) < new Date() ? "font-semibold text-red-600" : ""}>{fmtDate(i.dueDate)}</td>
                  <td className="num">{fmtAmount(i.total)}</td><td className="num">{fmtAmount(i.balance)}</td>
                  <td><input className="input text-right" inputMode="decimal" value={alloc[i.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })} aria-label={`Allocate to ${i.number}`} /></td>
                </tr>
              ))}</tbody>
              <tfoot>
                <tr className="font-semibold"><td colSpan={side === "supplier" ? 6 : 5} className="text-right">Allocated</td><td className="num">{fmtAmount(allocated)}</td></tr>
                <tr className={rest < 0 ? "font-semibold text-red-600" : "text-ink-soft"}><td colSpan={side === "supplier" ? 6 : 5} className="text-right">{rest < 0 ? "Over-allocated by" : "Held on account (advance)"}</td><td className="num">{fmtAmount(Math.abs(rest))}</td></tr>
              </tfoot>
            </table>
          )}
        </Card>
      )}
      {!isBase && <Notice>The receivable or payable is cleared at each invoice&apos;s own rate; the difference to this payment&apos;s rate is posted as a realised exchange difference.</Notice>}
      <FormActions><button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button><button className={btn("action")} disabled={pending || !party || rest < 0}>{side === "customer" ? "Record receipt" : "Record payment"}</button></FormActions>
    </form>
  );
}
