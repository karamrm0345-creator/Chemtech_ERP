"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveQuotationAction, saveSalesOrderAction } from "@/app/actions/sales";
import { useAction } from "@/components/forms/use-action";
import { Field, Select, FormActions } from "@/components/forms/fields";
import { EntityPicker } from "@/components/forms/entity-picker";
import { LineItemsEditor, newLine, hasPrices, CurrencyWarning, type LineState } from "@/components/forms/line-items";
import { btn, Card } from "@/components/ui/primitives";

export interface SalesDocInitial {
  customerId: string | null; customerLabel?: string; contactId?: string; currency: string; date?: string;
  paymentTerms?: string; deliveryTerms?: string; notes?: string;
  reference?: string; validUntil?: string; // quotation
  customerPoRef?: string; requiredDate?: string; warehouseId?: string; shippingAddress?: string; // order
  lines: LineState[];
}

export function SalesDocForm({ kind, id, initial, currencies, warehouses, defaultTax }: {
  kind: "quotation" | "order"; id: string | null; initial: SalesDocInitial; currencies: string[]; warehouses: { value: string; label: string }[]; defaultTax: string;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ ...initial, lines: undefined });
  const [lines, setLines] = useState<LineState[]>(initial.lines.length ? initial.lines : [newLine(defaultTax)]);
  const [partyCurrency, setPartyCurrency] = useState<string | undefined>();
  const [contacts, setContacts] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    if (!h.customerId) { setContacts([]); return; }
    fetch(`/api/lookup/contacts?customerId=${h.customerId}`).then((r) => (r.ok ? r.json() : [])).then(setContacts).catch(() => setContacts([]));
  }, [h.customerId]);
  const s = (k: keyof typeof h) => ({ value: (h[k] as string) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setH({ ...h, [k]: e.target.value }) });
  const base = kind === "quotation" ? "/sales/quotations" : "/sales/orders";
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const payload = { ...h, lines: lines.map(({ key: _k, itemLabel: _l, ...l }) => l) };
      await run(() => (kind === "quotation" ? saveQuotationAction(id, payload) : saveSalesOrderAction(id, payload)), { redirect: (d) => `${base}/${(d as { id: string }).id}` });
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer" required className="lg:col-span-2">
            <EntityPicker entity="customers" value={h.customerId} initialLabel={h.customerLabel} placeholder="Select customer"
              onChange={(o) => {
                const custCur = o?.data?.currency ? String(o.data.currency) : undefined;
                setPartyCurrency(custCur);
                setH({ ...h, customerId: o?.id ?? null, customerLabel: o?.label, contactId: "", currency: custCur && !hasPrices(lines) ? custCur : h.currency, paymentTerms: h.paymentTerms || String(o?.data?.paymentTerms ?? ""), shippingAddress: h.shippingAddress || String(o?.data?.address ?? "") });
              }} />
          </Field>
          <Field label="Contact"><Select value={h.contactId ?? ""} onChange={(v) => setH({ ...h, contactId: v })} options={contacts.map((c) => ({ value: c.id, label: c.label }))} placeholder="—" /></Field>
          <Field label="Date"><input type="date" className="input" {...s("date")} /></Field>
          <Field label="Currency"><Select value={h.currency} onChange={(v) => setH({ ...h, currency: v })} options={currencies.map((c) => ({ value: c, label: c }))} /></Field>
          {kind === "quotation" ? (
            <>
              <Field label="Customer reference / enquiry"><input className="input" {...s("reference")} /></Field>
              <Field label="Valid until"><input type="date" className="input" {...s("validUntil")} /></Field>
            </>
          ) : (
            <>
              <Field label="Customer PO reference"><input className="input" {...s("customerPoRef")} /></Field>
              <Field label="Required date"><input type="date" className="input" {...s("requiredDate")} /></Field>
              <Field label="Fulfilment warehouse" required><Select required value={h.warehouseId ?? ""} onChange={(v) => setH({ ...h, warehouseId: v })} options={warehouses} placeholder="Select" /></Field>
            </>
          )}
          <Field label="Payment terms"><input className="input" {...s("paymentTerms")} /></Field>
          <Field label="Delivery terms" hint="e.g. DAP Ras Laffan, Ex-Works Doha"><input className="input" {...s("deliveryTerms")} /></Field>
          {kind === "order" && <Field label="Shipping address" className="sm:col-span-2"><input className="input" {...s("shippingAddress")} /></Field>}
        </div>
      </Card>
      <CurrencyWarning party={h.customerLabel} partyCurrency={partyCurrency} currency={h.currency} show={hasPrices(lines)} />
      <Card title="Items & services">
        <LineItemsEditor lines={lines} onChange={setLines} currency={h.currency} defaultTax={defaultTax} />
      </Card>
      <Card title="Notes & terms"><textarea className="input" rows={3} {...s("notes")} placeholder="Shown on the printed document" /></Card>
      <FormActions>
        <button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button>
        <button className={btn("action")} disabled={pending || !h.customerId}>{pending ? "Saving…" : `Save ${kind === "quotation" ? "quotation" : "sales order"} as draft`}</button>
      </FormActions>
    </form>
  );
}
