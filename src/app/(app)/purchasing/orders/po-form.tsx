"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePoAction } from "@/app/actions/purchasing";
import { useAction } from "@/components/forms/use-action";
import { Field, Select, Check, FormActions } from "@/components/forms/fields";
import { EntityPicker } from "@/components/forms/entity-picker";
import { LineItemsEditor, newLine, hasPrices, CurrencyWarning, type LineState } from "@/components/forms/line-items";
import { btn, Card, Notice } from "@/components/ui/primitives";

export interface PoInitial {
  supplierId: string | null; supplierLabel?: string; supplierQuotationId?: string; supplierQuotationNo?: string; purchaseRequestId?: string; purchaseRequestNo?: string;
  supplierQuoteRef?: string; date: string; expectedDate?: string; warehouseId: string; currency: string; paymentTerms?: string; deliveryTerms?: string;
  allowPartial: boolean; freight: string; otherCharges: string; notes?: string; lines: LineState[];
}

export function PoForm({ id, initial, currencies, warehouses, defaultTax }: { id: string | null; initial: PoInitial; currencies: string[]; warehouses: { value: string; label: string }[]; defaultTax: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ ...initial, lines: undefined });
  const [lines, setLines] = useState<LineState[]>(initial.lines.length ? initial.lines : [newLine(defaultTax)]);
  const [partyCurrency, setPartyCurrency] = useState<string | undefined>();
  const t = (k: keyof typeof h) => ({ value: (h[k] as string) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setH({ ...h, [k]: e.target.value }) });
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      await run(() => savePoAction(id, { ...h, lines: lines.map(({ key: _k, itemLabel: _l, ...l }) => l) }), { redirect: (d) => `/purchasing/orders/${(d as { id: string }).id}` });
    }}>
      {(initial.supplierQuotationNo || initial.purchaseRequestNo) && <Notice>Linked to {[initial.purchaseRequestNo && `purchase request ${initial.purchaseRequestNo}`, initial.supplierQuotationNo && `supplier quotation ${initial.supplierQuotationNo}`].filter(Boolean).join(" and ")}.</Notice>}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Supplier" required className="lg:col-span-2">
            <EntityPicker entity="suppliers" value={h.supplierId} initialLabel={h.supplierLabel} disabled={!!initial.supplierQuotationId}
              onChange={(o) => {
                const supCur = o?.data?.currency ? String(o.data.currency) : undefined;
                setPartyCurrency(supCur);
                // Only adopt the supplier's currency while no prices are entered; never reinterpret existing prices.
                setH({ ...h, supplierId: o?.id ?? null, supplierLabel: o?.label, currency: supCur && !hasPrices(lines) ? supCur : h.currency, paymentTerms: h.paymentTerms || String(o?.data?.paymentTerms ?? "") });
              }} />
          </Field>
          <Field label="Supplier quotation ref."><input className="input" {...t("supplierQuoteRef")} /></Field>
          <Field label="Order date"><input type="date" className="input" {...t("date")} /></Field>
          <Field label="Expected delivery" required><input type="date" className="input" required {...t("expectedDate")} /></Field>
          <Field label="Deliver to warehouse" required><Select required value={h.warehouseId} onChange={(v) => setH({ ...h, warehouseId: v })} options={warehouses} placeholder="Select" /></Field>
          <Field label="Currency"><Select value={h.currency} onChange={(v) => setH({ ...h, currency: v })} options={currencies.map((c) => ({ value: c, label: c }))} /></Field>
          <Field label="Payment terms"><input className="input" {...t("paymentTerms")} /></Field>
          <Field label="Delivery terms (Incoterms)" className="lg:col-span-2"><input className="input" {...t("deliveryTerms")} /></Field>
          <Field label="Freight"><input className="input" inputMode="decimal" {...t("freight")} /></Field>
          <Field label="Other charges"><input className="input" inputMode="decimal" {...t("otherCharges")} /></Field>
          <div className="sm:col-span-2 lg:col-span-4"><Check label="Partial deliveries allowed" hint="When off, a goods receipt must complete the order unless a procurement approver authorises an exception." checked={h.allowPartial} onChange={(v) => setH({ ...h, allowPartial: v })} /></div>
        </div>
      </Card>
      <CurrencyWarning party={h.supplierLabel} partyCurrency={partyCurrency} currency={h.currency} show={hasPrices(lines)} />
      <Card title="Order lines">
        <LineItemsEditor lines={lines} onChange={setLines} priceField="purchasePrice" currency={h.currency} defaultTax={defaultTax} extraCharges={Number(h.freight || 0) + Number(h.otherCharges || 0)} />
        <p className="mt-2 text-xs text-ink-muted">Freight and other charges are allocated to stocked lines by value to compute landed cost at goods receipt.</p>
      </Card>
      <Card title="Notes & special instructions"><textarea className="input" rows={3} {...t("notes")} /></Card>
      <FormActions>
        <button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button>
        <button className={btn("action")} disabled={pending || !h.supplierId}>Save purchase order as draft</button>
      </FormActions>
    </form>
  );
}
