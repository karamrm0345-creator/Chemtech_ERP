"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveBudgetAction } from "@/app/actions/accounting";
import { useAction } from "@/components/forms/use-action";
import { Select } from "@/components/forms/fields";
import { btn, Card } from "@/components/ui/primitives";
import { fmtAmount } from "@/lib/format";

type Row = { accountId: string; annual: string };

/** Annual amount per account; the server spreads it evenly over the months of the year. */
export function BudgetEditor({ budget, accounts, rows: initial, months }: {
  budget: { id: string; name: string; fiscalYearId: string; costCenterId: string | null; notes: string | null };
  accounts: { value: string; label: string; type: string }[]; rows: Row[]; months: number;
}) {
  const { run, pending } = useAction();
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : [{ accountId: "", annual: "" }]);
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const total = (t: string) => rows.filter((r) => accounts.find((a) => a.value === r.accountId)?.type === t).reduce((s, r) => s + (Number(r.annual) || 0), 0);
  return (
    <Card title="Budget by account (annual)" bodyClass="p-0">
      <form onSubmit={async (e) => {
        e.preventDefault();
        await run(() => saveBudgetAction(budget.id, { name: budget.name, fiscalYearId: budget.fiscalYearId, costCenterId: budget.costCenterId ?? undefined, notes: budget.notes ?? undefined, lines: rows.filter((r) => r.accountId && r.annual).map((r) => ({ accountId: r.accountId, annual: r.annual })) }));
      }}>
        <table className="table-base">
          <thead><tr><th>Account</th><th className="w-44 text-right">Annual amount (QAR)</th><th className="w-36 text-right">Per month</th><th /></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td><Select value={r.accountId} onChange={(v) => set(i, { accountId: v })} options={accounts} placeholder="Select income or expense account…" /></td>
              <td><input className="input text-right" inputMode="decimal" value={r.annual} onChange={(e) => set(i, { annual: e.target.value })} aria-label="Annual amount" /></td>
              <td className="num text-ink-soft">{r.annual ? fmtAmount((Number(r.annual) || 0) / months) : ""}</td>
              <td><button type="button" className="rounded p-1 text-ink-soft hover:text-red-600" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
            </tr>
          ))}</tbody>
          <tfoot>
            <tr><td colSpan={4}><button type="button" className={btn("outline", "py-1 text-xs")} onClick={() => setRows([...rows, { accountId: "", annual: "" }])}><Plus className="h-3.5 w-3.5" /> Add account</button></td></tr>
            <tr className="font-semibold"><td className="text-right">Income {fmtAmount(total("INCOME"))} · Expense {fmtAmount(total("EXPENSE"))} · Result</td><td className="num">{fmtAmount(total("INCOME") - total("EXPENSE"))}</td><td colSpan={2} className="text-right"><button className={btn("action")} disabled={pending}>Save budget</button></td></tr>
          </tfoot>
        </table>
      </form>
    </Card>
  );
}
