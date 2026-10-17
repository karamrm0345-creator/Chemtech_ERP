import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { getReport, runReport } from "@/server/services/reports";
import { PageHeader, LinkButton, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar, type FilterDef } from "@/components/ui/list-toolbar";
import { PrintButton } from "@/components/print-button";
import { reportParams } from "@/lib/report-params";
import { formatCell } from "@/lib/report-format";
import { humanize } from "@/lib/format";
import type { SP } from "@/lib/params";
import { ReportExtraFilters } from "./extra";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SP> }) {
  const { key } = await params;
  const def = getReport(key);
  if (!def) notFound();
  const user = await requireUser(def.permission);
  const sp = await searchParams;
  const out = await runReport(user, key, reportParams(sp));
  if (!out) notFound();
  const { result } = out;
  const kinds = new Set(def.filters.map((f) => f.kind));
  const filters: FilterDef[] = [];
  if (kinds.has("warehouse")) filters.push({ name: "warehouseId", label: "Warehouse", options: (await prisma.warehouse.findMany({ orderBy: { code: "asc" } })).map((w) => ({ value: w.id, label: w.code })) });
  if (kinds.has("category")) filters.push({ name: "categoryId", label: "Category", options: (await prisma.itemCategory.findMany({ orderBy: { name: "asc" } })).map((c) => ({ value: c.id, label: c.name })) });
  const st = def.filters.find((f) => f.kind === "status");
  if (st?.options) filters.push({ name: "status", label: "Status", options: st.options.map((o) => ({ value: o, label: humanize(o) })) });
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]).toString();
  const canExport = user.permissions.has("reports.export");
  const numeric = (t?: string) => t === "money" || t === "qty" || t === "int" || t === "pct";
  return (
    <>
      <PageHeader title={def.title} subtitle={def.description} crumbs={[{ label: "Reports", href: "/reports" }, { label: def.title }]}
        actions={<>
          {canExport && <LinkButton variant="outline" href={`/api/reports/${key}/export?format=xlsx&${qs}`}><Download className="h-4 w-4" /> Excel</LinkButton>}
          {canExport && <LinkButton variant="outline" href={`/api/reports/${key}/export?format=csv&${qs}`}><Download className="h-4 w-4" /> CSV</LinkButton>}
          <PrintButton />
        </>} />
      {(def.filters.length > 0) && (
        <ListToolbar dateRange={kinds.has("dateRange")} filters={filters} placeholder={kinds.has("text") ? "Search…" : "Search (where supported)…"}>
          <ReportExtraFilters customer={kinds.has("customer")} supplier={kinds.has("supplier")} days={kinds.has("days")} />
        </ListToolbar>
      )}
      {result.note && <div className="mb-3"><Notice>{result.note}</Notice></div>}
      <p className="mb-2 text-xs text-ink-muted">{result.rows.length.toLocaleString()} row(s)</p>
      <DataTable basePath={`/reports/${key}`} empty="No data for the selected filters"
        columns={result.columns.map((c) => ({ label: c.label, align: numeric(c.type) ? "right" as const : undefined }))}
        rows={result.rows.slice(0, 2000).map((r, i) => ({ key: String(i), cells: result.columns.map((c) => formatCell(r[c.key], c.type)) }))}
        footer={result.totals ? <tfoot><tr className="font-bold">{result.columns.map((c, i) => <td key={c.key} className={numeric(c.type) ? "num" : ""}>{i === 0 ? "Total" : result.totals![c.key] !== undefined ? formatCell(result.totals![c.key], c.type) : ""}</td>)}</tr></tfoot> : undefined} />
      {result.rows.length > 2000 && <p className="mt-2 text-xs text-ink-muted">Showing the first 2,000 rows. Export to see all rows.</p>}
    </>
  );
}
