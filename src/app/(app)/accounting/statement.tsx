import Link from "next/link";
import type { AccountNode } from "@/server/services/accounting";
import { fmtAmount } from "@/lib/format";
import { cn } from "@/lib/cn";

/** Hierarchical statement section (accounts with zero balance and no activity are hidden). */
export function StatementSection({ title, nodes, total, totalLabel, query }: { title: string; nodes: AccountNode[]; total: { toString(): string } & Parameters<typeof fmtAmount>[0]; totalLabel: string; query: string }) {
  const shown = nodes.filter((n) => !n.dr.isZero() || !n.cr.isZero());
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-ink-soft">{title}</div>
      <table className="table-base">
        <tbody>
          {shown.length === 0 && <tr><td className="text-ink-soft">No balances</td><td /></tr>}
          {shown.map((n) => (
            <tr key={n.id} className={cn(n.isGroup && "font-semibold")}>
              <td style={{ paddingLeft: `${1 + n.depth * 1.25}rem` }}>
                {n.isGroup ? n.name : <Link className="link" href={`/accounting/ledger?account=${n.id}&${query}`}>{n.name}</Link>}
                <span className="ml-2 font-mono text-xs text-ink-soft">{n.code}</span>
              </td>
              <td className="num">{fmtAmount(n.balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="bg-panel/60 font-bold"><td>{totalLabel}</td><td className="num">{fmtAmount(total)}</td></tr></tfoot>
      </table>
    </div>
  );
}
