import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { hrefWith, type SP } from "@/lib/params";
import { EmptyState } from "./primitives";

export interface Col { label: string; sort?: string; align?: "left" | "right" | "center"; className?: string }
export interface Row { key: string; cells: React.ReactNode[]; className?: string }

export function DataTable({
  columns, rows, total, page = 1, pageSize = 20, basePath, sp = {}, empty = "No records found", emptyHint, footer,
}: {
  columns: Col[]; rows: Row[]; total?: number; page?: number; pageSize?: number; basePath: string; sp?: SP;
  empty?: string; emptyHint?: string; footer?: React.ReactNode;
}) {
  const sort = typeof sp.sort === "string" ? sp.sort : undefined;
  const dir = sp.dir === "asc" ? "asc" : "desc";
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={cn(c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}>
                  {c.sort ? (
                    <Link scroll={false} className="inline-flex items-center gap-1 hover:text-brand-600"
                      href={hrefWith(basePath, sp, { sort: c.sort, dir: sort === c.sort && dir === "desc" ? "asc" : "desc", page: undefined })}>
                      {c.label}
                      {sort === c.sort && (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </Link>
                  ) : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length}><EmptyState title={empty} hint={emptyHint} /></td></tr>
            ) : rows.map((r) => (
              <tr key={r.key} className={r.className}>
                {r.cells.map((cell, i) => (
                  <td key={i} className={cn(columns[i]?.align === "right" && "num", columns[i]?.align === "center" && "text-center", columns[i]?.className)}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer}
        </table>
      </div>
      {total !== undefined && total > 0 && (
        <div className="no-print flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-sm text-ink-soft">
          <span>
            {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <PageLink disabled={page <= 1} href={hrefWith(basePath, sp, { page: page - 1 })}><ChevronLeft className="h-4 w-4" /></PageLink>
            <span className="px-2">Page {page} / {pages}</span>
            <PageLink disabled={page >= pages} href={hrefWith(basePath, sp, { page: page + 1 })}><ChevronRight className="h-4 w-4" /></PageLink>
          </div>
        </div>
      )}
    </div>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled?: boolean; children: React.ReactNode }) {
  if (disabled) return <span className="rounded border border-line p-1.5 opacity-40">{children}</span>;
  return <Link scroll={false} href={href} className="rounded border border-line bg-white p-1.5 hover:bg-panel">{children}</Link>;
}
