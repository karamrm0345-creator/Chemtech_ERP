"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { saveSupplierAction } from "@/app/actions/masterdata";
import { useAction } from "@/components/forms/use-action";
import { Field, Select, Check, FormActions, bind } from "@/components/forms/fields";
import { btn, Notice } from "@/components/ui/primitives";
import { SUPPLIER_CATEGORIES, PREQUAL, COUNTRIES, opts } from "@/lib/options";

export function SupplierForm({ id, initial, currencies, canBank }: { id: string | null; initial: Record<string, unknown>; currencies: string[]; canBank: boolean }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [s, setS] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v == null ? "" : String(v)])));
  const [active, setActive] = useState(initial.active !== false);
  const [dups, setDups] = useState<{ code: string; legalName: string }[]>([]);
  const b = (k: string) => bind(s, setS, k);
  const submit = async (ignore = false) => {
    const r = await run(() => saveSupplierAction(id, { ...s, active }, ignore), { refresh: false });
    if (!r?.ok) return;
    const d = r.data as { id: string | null; duplicates: { code: string; legalName: string }[] };
    if (d.duplicates.length) { setDups(d.duplicates); return; }
    router.push(`/suppliers/${d.id}`);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(false); }} className="card p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Legal company name" required className="lg:col-span-2"><input className="input" required {...b("legalName")} /></Field>
        <Field label="Supplier code" hint="Leave blank to auto-number"><input className="input" {...b("code")} /></Field>
        <Field label="Trading name"><input className="input" {...b("tradingName")} /></Field>
        <Field label="Category"><Select value={s.category || "OTHER"} onChange={(v) => setS({ ...s, category: v })} options={opts(SUPPLIER_CATEGORIES)} /></Field>
        <Field label="Prequalification status"><Select value={s.prequalStatus || "NOT_STARTED"} onChange={(v) => setS({ ...s, prequalStatus: v })} options={opts(PREQUAL)} /></Field>
        <Field label="Country"><Select value={s.country || "Qatar"} onChange={(v) => setS({ ...s, country: v })} options={COUNTRIES.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="City"><input className="input" {...b("city")} /></Field>
        <Field label="Email"><input type="email" className="input" {...b("email")} /></Field>
        <Field label="Address" className="sm:col-span-2"><input className="input" {...b("address")} /></Field>
        <Field label="Telephone"><input className="input" {...b("phone")} /></Field>
        <Field label="Website"><input className="input" {...b("website")} /></Field>
        <Field label="Tax registration no."><input className="input" {...b("taxRegNo")} /></Field>
        <Field label="CR number"><input className="input" {...b("crNumber")} /></Field>
        <Field label="Currency"><Select value={s.currency || "QAR"} onChange={(v) => setS({ ...s, currency: v })} options={currencies.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Payment terms"><input className="input" {...b("paymentTerms")} /></Field>
        <Field label="Payment term (days)"><input type="number" className="input" {...b("paymentTermDays")} /></Field>
        <Field label="Performance rating (0–5)"><input inputMode="decimal" className="input" {...b("rating")} /></Field>
        <Field label="Products & services supplied" className="sm:col-span-2 lg:col-span-3"><textarea className="input" rows={2} {...b("productsServices")} /></Field>
        <Field label="Notes" className="sm:col-span-2 lg:col-span-3"><textarea className="input" rows={2} {...b("notes")} /></Field>
        <Check label="Active supplier" checked={active} onChange={setActive} />
      </div>
      <fieldset className="mt-5 rounded-md border border-line p-4">
        <legend className="flex items-center gap-1 px-1 text-sm font-bold"><Lock className="h-3.5 w-3.5" /> Bank details (restricted)</legend>
        {canBank ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Bank name"><input className="input" {...b("bankName")} /></Field>
            <Field label="Account name"><input className="input" {...b("bankAccountName")} /></Field>
            <Field label="Account no."><input className="input" {...b("bankAccountNo")} /></Field>
            <Field label="IBAN"><input className="input" {...b("iban")} /></Field>
            <Field label="SWIFT"><input className="input" {...b("swift")} /></Field>
          </div>
        ) : <p className="text-sm text-ink-muted">Only users with the “Edit supplier bank details” permission can change bank information.</p>}
      </fieldset>
      {dups.length > 0 && (
        <div className="mt-4"><Notice tone="warning">
          <p className="font-semibold">Possible duplicate supplier(s):</p>
          <ul className="ml-4 list-disc">{dups.map((d) => <li key={d.code}>{d.code} — {d.legalName}</li>)}</ul>
          <button type="button" className={btn("outline", "mt-2")} onClick={() => submit(true)}>Create anyway</button>
        </Notice></div>
      )}
      <FormActions>
        <button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button>
        <button className={btn("action")} disabled={pending}>Save supplier</button>
      </FormActions>
    </form>
  );
}
