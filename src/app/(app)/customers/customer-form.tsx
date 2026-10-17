"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCustomerAction } from "@/app/actions/masterdata";
import { useAction } from "@/components/forms/use-action";
import { Field, Select, Check, FormActions, bind } from "@/components/forms/fields";
import { EntityPicker } from "@/components/forms/entity-picker";
import { btn, Notice } from "@/components/ui/primitives";
import { CUSTOMER_CATEGORIES, CUSTOMER_CATEGORY_LABEL, COUNTRIES } from "@/lib/options";

export type CustomerFormState = Record<string, string> & { active?: unknown };

export function CustomerForm({ id, initial, currencies, salesRepLabel }: { id: string | null; initial: Record<string, unknown>; currencies: string[]; salesRepLabel?: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [s, setS] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v == null ? "" : String(v)])));
  const [active, setActive] = useState(initial.active !== false);
  const [dups, setDups] = useState<{ code: string; legalName: string }[]>([]);
  const b = (k: string) => bind(s, setS, k);

  const submit = async (ignore = false) => {
    const r = await run(() => saveCustomerAction(id, { ...s, active }, ignore), { refresh: false });
    if (!r?.ok) return;
    const d = r.data as { id: string | null; duplicates: { code: string; legalName: string }[] };
    if (d.duplicates.length) { setDups(d.duplicates); return; }
    router.push(`/customers/${d.id}`);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(false); }} className="card p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Legal company name" required className="lg:col-span-2"><input className="input" required maxLength={200} {...b("legalName")} /></Field>
        <Field label="Customer code" hint="Leave blank to auto-number"><input className="input" maxLength={30} {...b("code")} /></Field>
        <Field label="Trading name"><input className="input" {...b("tradingName")} /></Field>
        <Field label="Category" required><Select value={s.category || "OTHER"} onChange={(v) => setS({ ...s, category: v })} options={CUSTOMER_CATEGORIES.map((c) => ({ value: c, label: CUSTOMER_CATEGORY_LABEL[c] }))} /></Field>
        <Field label="Classification" hint="e.g. A / B / C"><input className="input" maxLength={20} {...b("classification")} /></Field>
        <Field label="Country" required><Select value={s.country || "Qatar"} onChange={(v) => setS({ ...s, country: v })} options={COUNTRIES.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="City"><input className="input" {...b("city")} /></Field>
        <Field label="Email"><input type="email" className="input" {...b("email")} /></Field>
        <Field label="Address" className="sm:col-span-2"><input className="input" {...b("address")} /></Field>
        <Field label="Telephone"><input className="input" {...b("phone")} /></Field>
        <Field label="Tax registration no."><input className="input" {...b("taxRegNo")} /></Field>
        <Field label="Commercial registration (CR)"><input className="input" {...b("crNumber")} /></Field>
        <Field label="Currency"><Select value={s.currency || "QAR"} onChange={(v) => setS({ ...s, currency: v })} options={currencies.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Payment terms"><input className="input" placeholder="e.g. 30 days from invoice" {...b("paymentTerms")} /></Field>
        <Field label="Payment term (days)"><input type="number" min={0} max={365} className="input" {...b("paymentTermDays")} /></Field>
        <Field label="Credit limit"><input inputMode="decimal" className="input" {...b("creditLimit")} /></Field>
        <Field label="Sales representative">
          <EntityPicker entity="users" value={s.salesRepId || null} initialLabel={salesRepLabel} onChange={(o) => setS({ ...s, salesRepId: o?.id ?? "" })} placeholder="Select user" />
        </Field>
        <Field label="Notes" className="sm:col-span-2 lg:col-span-3"><textarea className="input" rows={3} {...b("notes")} /></Field>
        <Check label="Active customer" checked={active} onChange={setActive} />
      </div>
      {dups.length > 0 && (
        <div className="mt-4">
          <Notice tone="warning">
            <p className="font-semibold">Possible duplicate customer(s) found:</p>
            <ul className="ml-4 list-disc">{dups.map((d) => <li key={d.code}>{d.code} — {d.legalName}</li>)}</ul>
            <button type="button" className={btn("outline", "mt-2")} onClick={() => submit(true)} disabled={pending}>This is a different company — create anyway</button>
          </Notice>
        </div>
      )}
      <FormActions>
        <button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button>
        <button className={btn("action")} disabled={pending}>{pending ? "Saving…" : "Save customer"}</button>
      </FormActions>
    </form>
  );
}
