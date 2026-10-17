"use client";
import { useState } from "react";
import { saveCountAction } from "@/app/actions/inventory";
import { useAction } from "@/components/forms/use-action";
import { btn } from "@/components/ui/primitives";

type R = { id: string; code: string; name: string; uom: string; batch: string; systemQty: string; countedQty: string };

export function CountSheet({ countId, rows, editable }: { countId: string; rows: R[]; editable: boolean }) {
  const { run, pending } = useAction();
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.id, r.countedQty])));
  const [filter, setFilter] = useState("");
  const shown = rows.filter((r) => !filter || `${r.code} ${r.name}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3 no-print">
        <input className="input max-w-xs" placeholder="Filter items…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="flex gap-2">
          <button className={btn("outline")} onClick={() => window.print()}>Print count sheet</button>
          {editable && <button className={btn("primary")} disabled={pending} onClick={() => run(() => saveCountAction(countId, Object.entries(vals).map(([lineId, countedQty]) => ({ lineId, countedQty: countedQty === "" ? null : countedQty }))))}>Save counts</button>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>Item</th><th>Description</th><th>Batch</th><th className="text-right">System qty</th><th className="w-36 text-right">Counted</th><th className="text-right">Variance</th></tr></thead>
          <tbody>
            {shown.map((r) => {
              const v = vals[r.id];
              const variance = v === "" || v === undefined ? null : Number(v) - Number(r.systemQty);
              return (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.code}</td><td>{r.name}</td><td className="text-xs">{r.batch}</td>
                  <td className="num">{Number(r.systemQty).toLocaleString()} {r.uom}</td>
                  <td>{editable ? <input className="input py-1 text-right" inputMode="decimal" value={v ?? ""} onChange={(e) => setVals({ ...vals, [r.id]: e.target.value })} /> : <span className="block text-right">{v || "—"}</span>}</td>
                  <td className={`num font-semibold ${variance && variance < 0 ? "text-red-600" : variance && variance > 0 ? "text-green-700" : ""}`}>{variance === null ? "" : variance > 0 ? `+${variance}` : variance}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
