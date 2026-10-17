import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, LinkButton, StatusBadge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { dateRange, listArgs, str, type SP } from "@/lib/params";
import { fmtDate, humanize } from "@/lib/format";
import { opts } from "@/lib/options";

export const metadata = { title: "Stock documents" };

export default async function DocsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("inventory.view");
  const sp = await searchParams;
  const a = listArgs(sp);
  const { from, to } = dateRange(sp);
  const where: Prisma.StockDocumentWhereInput = {
    ...(str(sp, "type") ? { type: str(sp, "type") as never } : {}),
    ...(str(sp, "status") ? { status: str(sp, "status") as never } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(a.q ? { OR: [{ number: { contains: a.q, mode: "insensitive" } }, { reason: { contains: a.q, mode: "insensitive" } }, { reference: { contains: a.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, whs] = await Promise.all([
    prisma.stockDocument.findMany({ where, orderBy: { createdAt: "desc" }, skip: (a.page - 1) * a.pageSize, take: a.pageSize, include: { _count: { select: { lines: true } } } }),
    prisma.stockDocument.count({ where }),
    prisma.warehouse.findMany(),
  ]);
  const wh = new Map(whs.map((w) => [w.id, w.code]));
  const can = (p: string) => user.permissions.has(p);
  return (
    <>
      <PageHeader title="Stock documents" subtitle="Opening balances, adjustments, transfers and internal issues. Every posted line writes to the stock ledger." crumbs={[{ label: "Store & inventory" }, { label: "Stock documents" }]}
        actions={<>
          {can("inventory.transfer") && <LinkButton variant="outline" href="/inventory/documents/new?type=TRANSFER">Transfer</LinkButton>}
          {can("inventory.issue") && <LinkButton variant="outline" href="/inventory/documents/new?type=ISSUE">Internal issue</LinkButton>}
          {can("inventory.adjust") && <LinkButton variant="action" href="/inventory/documents/new?type=ADJUSTMENT"><Plus className="h-4 w-4" /> Adjustment / opening</LinkButton>}
        </>} />
      <ListToolbar dateRange placeholder="Search number, reason, reference…" filters={[
        { name: "type", label: "Type", options: opts(["OPENING", "ADJUSTMENT", "TRANSFER", "ISSUE"]) },
        { name: "status", label: "Status", options: opts(["DRAFT", "POSTED", "CANCELLED", "REVERSED"]) },
      ]} />
      <DataTable basePath="/inventory/documents" sp={sp} total={total} page={a.page} pageSize={a.pageSize} empty="No stock documents"
        columns={[{ label: "Number" }, { label: "Date" }, { label: "Type" }, { label: "Warehouse" }, { label: "Lines", align: "right" }, { label: "Reason / reference" }, { label: "Status" }]}
        rows={rows.map((d) => ({ key: d.id, cells: [
          <Link key="n" className="link" href={`/inventory/documents/${d.id}`}>{d.number}</Link>, fmtDate(d.date), humanize(d.type),
          d.toWarehouseId ? `${wh.get(d.warehouseId)} → ${wh.get(d.toWarehouseId)}` : wh.get(d.warehouseId), d._count.lines,
          <span key="r" className="text-xs">{d.reason}{d.reference && ` · ${d.reference}`}</span>,
          <StatusBadge key="s" status={d.status === "DRAFT" && (d.type === "ADJUSTMENT" || d.type === "OPENING") ? "SUBMITTED" : d.status} label={d.status === "DRAFT" && (d.type === "ADJUSTMENT" || d.type === "OPENING") ? "Awaiting approval" : undefined} />,
        ] }))} />
    </>
  );
}
