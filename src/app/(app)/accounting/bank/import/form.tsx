"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { importStatementAction } from "@/app/actions/accounting";
import { useAction } from "@/components/forms/use-action";
import { Field, FormActions, Select } from "@/components/forms/fields";
import { btn, Card, Notice } from "@/components/ui/primitives";

export function ImportForm({ banks, suggestions }: { banks: { value: string; label: string }[]; suggestions: Record<string, string> }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ accountId: banks[0]?.value ?? "", reference: "", statementDate: "", openingBalance: suggestions[banks[0]?.value ?? ""] ?? "", closingBalance: "", csv: "" });
  const [file, setFile] = useState("");
  return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); await run(() => importStatementAction(h), { redirect: (d) => `/accounting/bank/${(d as { id: string }).id}` }); }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Bank account" required><Select value={h.accountId} onChange={(v) => setH({ ...h, accountId: v, openingBalance: suggestions[v] ?? h.openingBalance })} options={banks} required /></Field>
          <Field label="Statement number / reference" required><input className="input" required maxLength={100} value={h.reference} onChange={(e) => setH({ ...h, reference: e.target.value })} placeholder="e.g. 2026-11" /></Field>
          <Field label="Statement date" hint="Blank = date of the last line"><input type="date" className="input" value={h.statementDate} onChange={(e) => setH({ ...h, statementDate: e.target.value })} /></Field>
          <Field label="Opening balance" required hint="From the statement; filled from the last imported closing balance"><input className="input text-right" inputMode="decimal" required value={h.openingBalance} onChange={(e) => setH({ ...h, openingBalance: e.target.value })} /></Field>
          <Field label="Closing balance" required><input className="input text-right" inputMode="decimal" required value={h.closingBalance} onChange={(e) => setH({ ...h, closingBalance: e.target.value })} /></Field>
          <Field label="Statement file (CSV)" required>
            <input type="file" accept=".csv,text/csv" className="input" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFile(f.name); setH({ ...h, csv: await f.text() }); } }} />
          </Field>
        </div>
      </Card>
      <Field label={file ? `Contents of ${file} (you can correct it here)` : "…or paste the CSV"}><textarea className="input font-mono text-xs" rows={8} value={h.csv} onChange={(e) => setH({ ...h, csv: e.target.value })} placeholder={"Date,Description,Reference,Debit,Credit\n02/11/2026,Transfer from customer,TT-1001,,5000.00"} /></Field>
      <Notice>The file needs a header row with <b>Date</b> and <b>Description</b> columns and either one signed <b>Amount</b> column or separate <b>Debit</b> / <b>Credit</b> (Withdrawal / Deposit) columns. A <b>Reference</b> column helps automatic matching. Opening balance plus the lines must equal the closing balance.</Notice>
      <FormActions><button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button><button className={btn("action")} disabled={pending || !h.csv}>Import statement</button></FormActions>
    </form>
  );
}
