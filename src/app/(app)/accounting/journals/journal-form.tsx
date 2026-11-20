"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { saveJournalAction } from "@/app/actions/accounting";
import { useAction } from "@/components/forms/use-action";
import { Field, FormActions, Select } from "@/components/forms/fields";
import { EntityPicker } from "@/components/forms/entity-picker";
import { btn, Card } from "@/components/ui/primitives";

type Line = { accountId: string; debit: string; credit: string; partyType: string; partyId: string; partyLabel?: string; description: string; costCenterId: string };
const blank = (): Line => ({ accountId: "", debit: "", credit: "", partyType: "", partyId: "", description: "", costCenterId: "" });
const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function JournalForm({ id, accounts, costCenters = [], initial }: {
  id?: string;
  accounts: { value: string; label: string }[];
  costCenters?: { value: string; label: string }[];
  initial: { date: string; memo: string; reference: string; type: string; lines: Line[] };
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [h, setH] = useState({ date: initial.date, memo: initial.memo, reference: initial.reference, type: initial.type });
  const [lines, setLines] = useState<Line[]>(initial.lines.length ? initial.lines : [blank(), blank()]);
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const totals = useMemo(() => {
    const dr = lines.reduce((s, l) => s + n(l.debit), 0), cr = lines.reduce((s, l) => s + n(l.credit), 0);
    return { dr, cr, diff: Math.round((dr - cr) * 100) / 100 };
  }, [lines]);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const payload = { ...h, lines: lines.filter((l) => l.accountId).map(({ partyLabel: _, ...l }) => l) };
      await run(() => saveJournalAction(id ?? null, payload), { redirect: (d) => `/accounting/journals/${(d as { id: string }).id}` });
    }}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Date" required><input type="date" className="input" required value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} /></Field>
          <Field label="Type"><Select value={h.type} onChange={(v) => setH({ ...h, type: v })} options={[{ value: "MANUAL", label: "Manual journal" }, { value: "OPENING", label: "Opening balance" }]} /></Field>
          <Field label="Reference"><input className="input" value={h.reference} onChange={(e) => setH({ ...h, reference: e.target.value })} maxLength={100} /></Field>
          <Field label="Memo" required><input className="input" required value={h.memo} onChange={(e) => setH({ ...h, memo: e.target.value })} maxLength={500} /></Field>
        </div>
      </Card>
      <Card bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>#</th><th className="min-w-[16rem]">Account</th><th className="min-w-[14rem]">Party (optional)</th><th>Description</th>{costCenters.length > 0 && <th>Cost centre</th>}<th className="w-32 text-right">Debit</th><th className="w-32 text-right">Credit</th><th /></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><Select value={l.accountId} onChange={(v) => set(i, { accountId: v })} options={accounts} placeholder="Select account…" /></td>
                <td>
                  <div className="flex gap-1">
                    <select className="input w-28" value={l.partyType} onChange={(e) => set(i, { partyType: e.target.value, partyId: "", partyLabel: "" })} aria-label="Party type">
                      <option value="">—</option><option value="CUSTOMER">Customer</option><option value="SUPPLIER">Supplier</option>
                    </select>
                    {l.partyType && <div className="flex-1"><EntityPicker entity={l.partyType === "CUSTOMER" ? "customers" : "suppliers"} value={l.partyId || null} initialLabel={l.partyLabel} onChange={(o) => set(i, { partyId: o?.id ?? "", partyLabel: o?.label })} /></div>}
                  </div>
                </td>
                <td><input className="input" value={l.description} onChange={(e) => set(i, { description: e.target.value })} maxLength={300} /></td>
                {costCenters.length > 0 && <td><Select value={l.costCenterId} onChange={(v) => set(i, { costCenterId: v })} options={costCenters} placeholder="—" /></td>}
                <td><input className="input text-right" inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td>
                <td><input className="input text-right" inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
                <td><button type="button" className="rounded p-1 text-ink-soft hover:text-red-600" aria-label="Remove line" onClick={() => setLines(lines.length > 2 ? lines.filter((_, j) => j !== i) : lines)}><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}</tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={costCenters.length ? 5 : 4}><button type="button" className={btn("outline", "py-1 text-xs")} onClick={() => setLines([...lines, blank()])}><Plus className="h-3.5 w-3.5" /> Add line</button></td>
                <td className="num">{totals.dr.toFixed(2)}</td><td className="num">{totals.cr.toFixed(2)}</td><td />
              </tr>
              {totals.diff !== 0 && <tr><td colSpan={costCenters.length ? 8 : 7} className="text-right text-sm font-semibold text-red-600">Out of balance by {Math.abs(totals.diff).toFixed(2)} — it must balance before it can be posted.</td></tr>}
            </tfoot>
          </table>
        </div>
      </Card>
      <FormActions><button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button><button className={btn("action")} disabled={pending}>Save draft</button></FormActions>
    </form>
  );
}
