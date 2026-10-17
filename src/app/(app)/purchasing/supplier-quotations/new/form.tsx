"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSupplierQuoteAction } from "@/app/actions/purchasing";
import { useAction } from "@/components/forms/use-action";
import { Field, Select, FormActions } from "@/components/forms/fields";
import { EntityPicker } from "@/components/forms/entity-picker";
import { LineItemsEditor, newLine, type LineState } from "@/components/forms/line-items";
import { btn, Card } from "@/components/ui/primitives";
import { humanize } from "@/lib/format";

export function SupplierQuoteForm({ initial, currencies, criteria }: {
  initial: { rfqId: string; supplierId: string | null; supplierLabel?: string; currency: string; paymentTerms: string; date: string; lines: LineState[] };
  currencies: string[]; criteria: { id: string; name: string; weight: string }[];
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ supplierId: initial.supplierId, supplierLabel: initial.supplierLabel, supplierRef: "", date: initial.date, validUntil: "", currency: initial.currency, deliveryDays: "", paymentTerms: initial.paymentTerms, deliveryTerms: "", technicalCompliance: "NOT_EVALUATED", notes: "" });
  const [lines, setLines] = useState<LineState[]>(initial.lines.length ? initial.lines : [newLine()]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const t = (k: keyof typeof h) => ({ value: (h[k] as string) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setH({ ...h, [k]: e.target.value }) });
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const payload = { ...h, rfqId: initial.rfqId, lines: lines.map(({ key: _k, itemLabel: _l, ...l }) => l), scores: Object.entries(scores).filter(([, v]) => v !== "").map(([criterionId, score]) => ({ criterionId, score })) };
      await run(() => saveSupplierQuoteAction(null, payload), { redirect: (d) => initial.rfqId ? `/purchasing/rfqs/${initial.rfqId}` : `/purchasing/supplier-quotations/${(d as { id: string }).id}` });
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Supplier" required className="lg:col-span-2"><EntityPicker entity="suppliers" value={h.supplierId} initialLabel={h.supplierLabel} disabled={!!initial.rfqId && !!initial.supplierId} onChange={(o) => setH({ ...h, supplierId: o?.id ?? null, supplierLabel: o?.label, currency: String(o?.data?.currency ?? h.currency) })} /></Field>
          <Field label="Supplier quotation ref."><input className="input" {...t("supplierRef")} /></Field>
          <Field label="Quotation date"><input type="date" className="input" {...t("date")} /></Field>
          <Field label="Valid until"><input type="date" className="input" {...t("validUntil")} /></Field>
          <Field label="Currency"><Select value={h.currency} onChange={(v) => setH({ ...h, currency: v })} options={currencies.map((c) => ({ value: c, label: c }))} /></Field>
          <Field label="Delivery time (days)"><input type="number" min={0} className="input" {...t("deliveryDays")} /></Field>
          <Field label="Technical compliance"><Select value={h.technicalCompliance} onChange={(v) => setH({ ...h, technicalCompliance: v })} options={["NOT_EVALUATED", "COMPLIANT", "PARTIAL", "NON_COMPLIANT"].map((x) => ({ value: x, label: humanize(x) }))} /></Field>
          <Field label="Payment terms" className="lg:col-span-2"><input className="input" {...t("paymentTerms")} /></Field>
          <Field label="Delivery terms (Incoterms)" className="lg:col-span-2"><input className="input" {...t("deliveryTerms")} /></Field>
        </div>
      </Card>
      <Card title="Offered prices"><LineItemsEditor lines={lines} onChange={setLines} priceField="purchasePrice" currency={h.currency} /></Card>
      <Card title="Evaluation scores (0–10)">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {criteria.map((c) => <Field key={c.id} label={`${c.name} (w ${c.weight})`}><input className="input" type="number" min={0} max={10} step="0.5" value={scores[c.id] ?? ""} onChange={(e) => setScores({ ...scores, [c.id]: e.target.value })} /></Field>)}
        </div>
        <Field label="Notes" className="mt-3"><textarea className="input" rows={2} {...t("notes")} /></Field>
      </Card>
      <FormActions>
        <button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button>
        <button className={btn("action")} disabled={pending || !h.supplierId}>Save offer</button>
      </FormActions>
    </form>
  );
}
