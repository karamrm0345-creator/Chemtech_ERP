"use client";
import { Plus, Trash2 } from "lucide-react";
import { EntityPicker } from "./entity-picker";
import { fmtAmount } from "@/lib/format";

export interface LineState {
  key: string;
  itemId: string | null;
  itemLabel?: string;
  description: string;
  quantity: string;
  uom: string;
  unitPrice: string;
  discountPct: string;
  taxRate: string;
  // optional links kept when lines come from upstream documents
  prLineId?: string | null;
  rfqLineId?: string | null;
}

export const newLine = (taxRate = "0"): LineState => ({
  key: Math.random().toString(36).slice(2), itemId: null, description: "", quantity: "1", uom: "", unitPrice: "0", discountPct: "0", taxRate,
});

const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);
export function lineNet(l: LineState) {
  const gross = num(l.quantity) * num(l.unitPrice);
  return gross - (gross * num(l.discountPct)) / 100;
}
export function totals(lines: LineState[], extra = 0) {
  let gross = 0, discount = 0, tax = 0;
  for (const l of lines) {
    const g = num(l.quantity) * num(l.unitPrice);
    const d = (g * num(l.discountPct)) / 100;
    gross += g; discount += d; tax += ((g - d) * num(l.taxRate)) / 100;
  }
  return { gross, discount, tax, total: gross - discount + tax + extra };
}

/** Editable commercial lines (quotation / order / PO). Totals are recalculated server-side. */
export function LineItemsEditor({ lines, onChange, priceField = "sellingPrice", currency, extraCharges = 0, hideDiscount, defaultTax = "0" }: {
  lines: LineState[]; onChange: (l: LineState[]) => void; priceField?: "sellingPrice" | "purchasePrice"; currency: string;
  extraCharges?: number; hideDiscount?: boolean; defaultTax?: string;
}) {
  const set = (i: number, patch: Partial<LineState>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const t = totals(lines, extraCharges);
  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="table-base min-w-[880px]">
          <thead>
            <tr>
              <th className="w-8">#</th><th className="w-[260px]">Item</th><th>Description</th><th className="w-24 text-right">Qty</th>
              <th className="w-20">UoM</th><th className="w-28 text-right">Unit price</th>
              {!hideDiscount && <th className="w-20 text-right">Disc %</th>}
              <th className="w-20 text-right">Tax %</th><th className="w-32 text-right">Net</th><th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key}>
                <td className="pt-4 text-ink-muted">{i + 1}</td>
                <td>
                  <EntityPicker entity="items" value={l.itemId} initialLabel={l.itemLabel} placeholder="Item (optional)"
                    onChange={(o) => set(i, o ? {
                      itemId: o.id, itemLabel: o.label, description: l.description || String(o.data?.name ?? o.label),
                      uom: String(o.data?.uom ?? l.uom), unitPrice: String(o.data?.[priceField] ?? l.unitPrice),
                    } : { itemId: null, itemLabel: "" })} />
                </td>
                <td><input className="input" value={l.description} onChange={(e) => set(i, { description: e.target.value })} required maxLength={500} /></td>
                <td><input className="input text-right" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} required /></td>
                <td><input className="input" value={l.uom} onChange={(e) => set(i, { uom: e.target.value })} maxLength={20} /></td>
                <td><input className="input text-right" inputMode="decimal" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} /></td>
                {!hideDiscount && <td><input className="input text-right" inputMode="decimal" value={l.discountPct} onChange={(e) => set(i, { discountPct: e.target.value })} /></td>}
                <td><input className="input text-right" inputMode="decimal" value={l.taxRate} onChange={(e) => set(i, { taxRate: e.target.value })} /></td>
                <td className="num pt-4 font-medium">{fmtAmount(lineNet(l))}</td>
                <td className="pt-3">
                  <button type="button" aria-label="Remove line" disabled={lines.length === 1} className="rounded p-1 text-ink-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                    onClick={() => onChange(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700" onClick={() => onChange([...lines, newLine(defaultTax)])}>
          <Plus className="h-4 w-4" /> Add line
        </button>
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-ink-soft">Subtotal</dt><dd className="tabular-nums">{fmtAmount(t.gross)}</dd></div>
          {!hideDiscount && <div className="flex justify-between"><dt className="text-ink-soft">Discount</dt><dd className="tabular-nums">−{fmtAmount(t.discount)}</dd></div>}
          <div className="flex justify-between"><dt className="text-ink-soft">Tax</dt><dd className="tabular-nums">{fmtAmount(t.tax)}</dd></div>
          {extraCharges > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Freight & charges</dt><dd className="tabular-nums">{fmtAmount(extraCharges)}</dd></div>}
          <div className="flex justify-between border-t border-line pt-1 text-base font-bold"><dt>Total</dt><dd className="tabular-nums">{currency} {fmtAmount(t.total)}</dd></div>
        </dl>
      </div>
    </div>
  );
}

export const hasPrices = (lines: LineState[]) => lines.some((l) => Number(l.unitPrice) > 0);

/**
 * Shown when the document currency differs from the party's usual currency
 * while prices are already entered: prices are never converted silently.
 */
export function CurrencyWarning({ party, partyCurrency, currency, show }: { party?: string; partyCurrency?: string; currency: string; show: boolean }) {
  if (!show || !partyCurrency || partyCurrency === currency) return null;
  return (
    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {party ?? "This party"} usually trades in <b>{partyCurrency}</b>, but this document is in <b>{currency}</b>. Line prices are <b>not</b> converted automatically,
      so check that every unit price is in {currency} before saving, or change the currency and re-enter the prices.
    </p>
  );
}
