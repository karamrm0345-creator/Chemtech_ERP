"use client";
import { useState } from "react";
import { saveSettingsAction, saveSequenceAction, saveCurrencyAction, saveCriterionAction } from "@/app/actions/admin";
import { useAction } from "@/components/forms/use-action";
import { Field, Check, Select } from "@/components/forms/fields";
import { btn, Card } from "@/components/ui/primitives";
import { humanize } from "@/lib/format";

type S = Record<string, unknown>;

export function SettingsForm({ initial, currencies }: { initial: S; currencies: string[] }) {
  const { run, pending } = useAction();
  const [s, setS] = useState<S>(initial);
  const t = (k: string) => ({ value: String(s[k] ?? ""), onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value }) });
  const c = (k: string) => ({ checked: !!s[k], onChange: (v: boolean) => setS({ ...s, [k]: v }) });
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(() => saveSettingsAction(s)); }} className="space-y-4">
      <Card title="Company profile">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Display name" required><input className="input" required {...t("companyName")} /></Field>
          <Field label="Legal name"><input className="input" {...t("legalName")} /></Field>
          <Field label="CR number"><input className="input" {...t("crNumber")} /></Field>
          <Field label="Tax number"><input className="input" {...t("taxNumber")} /></Field>
          <Field label="Phone"><input className="input" {...t("phone")} /></Field>
          <Field label="Email"><input className="input" type="email" {...t("email")} /></Field>
          <Field label="Website"><input className="input" {...t("website")} /></Field>
          <Field label="Address" className="sm:col-span-2"><input className="input" {...t("address")} /></Field>
        </div>
      </Card>
      <Card title="Business rules">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Base currency" hint="Locked once transactions exist"><Select value={String(s.baseCurrency)} onChange={(v) => setS({ ...s, baseCurrency: v })} options={currencies.map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Default tax rate %" hint="Qatar currently has no VAT"><input className="input" {...t("defaultTaxRate")} /></Field>
          <Field label="Receipt over-tolerance %" hint="0 = cannot exceed ordered qty"><input className="input" {...t("grnTolerancePct")} /></Field>
          <Field label="Unusual adjustment alert (qty)"><input className="input" {...t("adjustmentAlertQty")} /></Field>
          <Field label="Slow-moving threshold (days)"><input className="input" type="number" {...t("slowMovingDays")} /></Field>
        </div>
        <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
          <Check label="Enable finance (invoices, receipts, supplier payments)" {...c("financeEnabled")} />
          <Check label="Purchase requests require approval" {...c("requirePrApproval")} />
          <Check label="Every purchase order requires a selected supplier quotation (RFQ stage mandatory)" {...c("requireRfq")} />
          <Check label="Every purchase order requires an approved purchase request" {...c("requirePrForPo")} />
          <Check label="Allow negative stock (only for users with the override permission)" {...c("allowNegativeStock")} />
        </div>
      </Card>
      <div className="flex justify-end"><button className={btn("action")} disabled={pending}>Save settings</button></div>
    </form>
  );
}

export function SequenceRow({ docType, prefix, padding, includeYear, next }: { docType: string; prefix: string; padding: number; includeYear: boolean; next: number }) {
  const { run, pending } = useAction();
  const [s, setS] = useState({ prefix, padding: String(padding), includeYear });
  return (
    <tr>
      <td className="font-medium">{humanize(docType)}</td>
      <td><input className="input w-24 py-1" value={s.prefix} onChange={(e) => setS({ ...s, prefix: e.target.value })} /></td>
      <td><input className="input w-20 py-1" type="number" min={3} max={10} value={s.padding} onChange={(e) => setS({ ...s, padding: e.target.value })} /></td>
      <td><input type="checkbox" checked={s.includeYear} onChange={(e) => setS({ ...s, includeYear: e.target.checked })} /></td>
      <td className="font-mono text-xs text-ink-soft">{s.prefix}{s.includeYear ? `-${new Date().getFullYear()}` : ""}-{String(next).padStart(Number(s.padding) || 5, "0")}</td>
      <td><button className={btn("outline", "py-1 text-xs")} disabled={pending} onClick={() => run(() => saveSequenceAction(docType, s))}>Save</button></td>
    </tr>
  );
}

export function CurrencyEditor({ base, currencies }: { base: string; currencies: { code: string; name: string; rateToBase: string; active: boolean }[] }) {
  const { run, pending } = useAction();
  const [rows, setRows] = useState(currencies);
  const [n, setN] = useState({ code: "", name: "", rateToBase: "" });
  return (
    <Card title={`Currencies (rate = ${base} per unit)`}>
      <table className="table-base">
        <thead><tr><th>Code</th><th>Name</th><th>Rate</th><th>Active</th><th /></tr></thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={c.code}>
              <td className="font-mono">{c.code}</td><td>{c.name}</td>
              <td><input className="input w-28 py-1" disabled={c.code === base} value={c.rateToBase} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, rateToBase: e.target.value } : r)))} /></td>
              <td><input type="checkbox" disabled={c.code === base} checked={c.active} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, active: e.target.checked } : r)))} /></td>
              <td>{c.code !== base && <button className={btn("outline", "py-1 text-xs")} disabled={pending} onClick={() => run(() => saveCurrencyAction(c))}>Save</button>}</td>
            </tr>
          ))}
          <tr>
            <td><input className="input w-20 py-1" placeholder="Code" maxLength={3} value={n.code} onChange={(e) => setN({ ...n, code: e.target.value })} /></td>
            <td><input className="input py-1" placeholder="Name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></td>
            <td><input className="input w-28 py-1" placeholder="Rate" value={n.rateToBase} onChange={(e) => setN({ ...n, rateToBase: e.target.value })} /></td>
            <td /><td><button className={btn("primary", "py-1 text-xs")} disabled={pending || !n.code} onClick={async () => { if (await run(() => saveCurrencyAction({ ...n, active: true }))) setN({ code: "", name: "", rateToBase: "" }); }}>Add</button></td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

export function CriteriaEditor({ criteria }: { criteria: { id: string; name: string; weight: string; active: boolean; sort: number }[] }) {
  const { run, pending } = useAction();
  const [rows, setRows] = useState(criteria);
  const [n, setN] = useState({ name: "", weight: "" });
  const total = rows.filter((r) => r.active).reduce((s, r) => s + Number(r.weight || 0), 0);
  return (
    <Card title="Supplier quotation evaluation criteria">
      <p className="mb-2 text-xs text-ink-soft">Scores (0–10) are weighted by these values on the comparison screen. Active weights total {total}.</p>
      <table className="table-base">
        <thead><tr><th>Criterion</th><th>Weight</th><th>Active</th><th /></tr></thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={c.id}>
              <td><input className="input py-1" value={c.name} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} /></td>
              <td><input className="input w-20 py-1" value={c.weight} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, weight: e.target.value } : r)))} /></td>
              <td><input type="checkbox" checked={c.active} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, active: e.target.checked } : r)))} /></td>
              <td><button className={btn("outline", "py-1 text-xs")} disabled={pending} onClick={() => run(() => saveCriterionAction(c.id, c))}>Save</button></td>
            </tr>
          ))}
          <tr>
            <td><input className="input py-1" placeholder="New criterion" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></td>
            <td><input className="input w-20 py-1" placeholder="Weight" value={n.weight} onChange={(e) => setN({ ...n, weight: e.target.value })} /></td>
            <td /><td><button className={btn("primary", "py-1 text-xs")} disabled={pending || !n.name} onClick={async () => { if (await run(() => saveCriterionAction(null, { ...n, active: true, sort: rows.length + 1 }))) setN({ name: "", weight: "" }); }}>Add</button></td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}
