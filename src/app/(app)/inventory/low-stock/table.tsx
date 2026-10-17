"use client";
import Link from "next/link";
import { useState } from "react";
import { lowStockPrAction } from "@/app/actions/purchasing";
import { useAction } from "@/components/forms/use-action";
import { btn, EmptyState, StatusBadge } from "@/components/ui/primitives";
import { fmtQty } from "@/lib/format";

type R = { id: string; code: string; name: string; uom: string; min: string; onHand: string; reserved: string; onOrder: string; suggested: string; supplier: string };

export function LowStockTable({ rows, canPr }: { rows: R[]; canPr: boolean }) {
  const { run, pending } = useAction();
  const [sel, setSel] = useState<Set<string>>(new Set(rows.filter((r) => Number(r.suggested) > 0).map((r) => r.id)));
  if (!rows.length) return <div className="card"><EmptyState title="No low-stock items" hint="All items with a minimum level are above it." /></div>;
  return (
    <div className="card overflow-hidden">
      {canPr && (
        <div className="flex items-center justify-between border-b border-line p-3">
          <span className="text-sm text-ink-soft">{sel.size} item(s) selected</span>
          <button className={btn("action")} disabled={pending || sel.size === 0} onClick={() => run(() => lowStockPrAction([...sel]), { redirect: (d) => `/purchasing/requests/${(d as { id: string }).id}` })}>Create purchase request</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead><tr>{canPr && <th className="w-8" />}<th>Item</th><th>Description</th><th className="text-right">Minimum</th><th className="text-right">On hand</th><th className="text-right">Reserved</th><th className="text-right">On order</th><th className="text-right">Suggested order</th><th>Preferred supplier</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {canPr && <td><input type="checkbox" disabled={Number(r.suggested) <= 0} checked={sel.has(r.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(r.id); else n.delete(r.id); setSel(n); }} /></td>}
                <td><Link className="link whitespace-nowrap font-mono text-xs" href={`/inventory/items/${r.id}`}>{r.code}</Link></td><td>{r.name}</td>
                <td className="num">{fmtQty(r.min)}</td><td className="num font-semibold">{fmtQty(r.onHand)} {r.uom}</td><td className="num">{fmtQty(r.reserved)}</td><td className="num">{fmtQty(r.onOrder)}</td>
                <td className="num font-bold">{Number(r.suggested) > 0 ? fmtQty(r.suggested) : <span className="text-xs font-normal text-ink-muted">covered by open POs</span>}</td>
                <td className="text-xs">{r.supplier}</td><td><StatusBadge status={Number(r.onHand) <= 0 ? "OUT" : "LOW"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
