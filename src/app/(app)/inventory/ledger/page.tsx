import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { listLedger } from "@/server/services/inventory";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { RefLink } from "@/components/ref-link";
import { dateRange, listArgs, str, type SP } from "@/lib/params";
import { fmtDateTime, fmtMoney, fmtQty, humanize } from "@/lib/format";
import { opts } from "@/lib/options";

export const metadata = { title: "Stock ledger" };
const TYPES = ["OPENING", "RECEIPT_PO", "ISSUE_DELIVERY", "ISSUE_INTERNAL", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "TRANSFER_OUT", "TRANSFER_IN", "COUNT_GAIN", "COUNT_LOSS", "RETURN_TO_SUPPLIER", "REVERSAL"];

export default async function LedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("inventory.view");
  const sp = await searchParams;
  const { from, to } = dateRange(sp);
  const [data, whs] = await Promise.all([
    listLedger(user, { ...listArgs(sp), warehouseId: str(sp, "warehouseId"), type: str(sp, "type"), from, to }),
    prisma.warehouse.findMany({ orderBy: { code: "asc" } }),
  ]);
  const wh = new Map(whs.map((w) => [w.id, w.code]));
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(data.rows.map((r) => r.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Stock movement ledger" subtitle="Immutable record of every posted stock movement: the source of truth for quantities." crumbs={[{ label: "Store & inventory" }, { label: "Ledger" }]}
        actions={user.permissions.has("reports.export") && <LinkButton variant="outline" href={`/api/reports/stock-ledger/export?format=xlsx&${qs}`}><Download className="h-4 w-4" /> Excel</LinkButton>} />
      <ListToolbar dateRange placeholder="Search reference or item…" filters={[
        { name: "warehouseId", label: "Warehouse", options: whs.map((w) => ({ value: w.id, label: w.code })) },
        { name: "type", label: "Type", options: opts(TYPES) },
      ]} />
      <DataTable basePath="/inventory/ledger" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No movements"
        columns={[{ label: "#" }, { label: "Date" }, { label: "Type" }, { label: "Reference" }, { label: "Item" }, { label: "WH" }, { label: "Qty", align: "right" }, { label: "Unit cost", align: "right" }, { label: "Value", align: "right" }, { label: "Balance", align: "right" }, { label: "User" }]}
        rows={data.rows.map((t) => ({ key: t.id, cells: [
          <span key="q" className="text-xs text-ink-muted">{t.seq}</span>, <span key="d" className="whitespace-nowrap text-xs">{fmtDateTime(t.txnDate)}</span>, <span key="t" className="text-xs">{humanize(t.type)}</span>,
          <RefLink key="r" type={t.refDocType} id={t.refDocId} no={t.refDocNo} />, <Link key="i" className="link text-xs" href={`/inventory/items/${t.itemId}`}>{t.item.code}</Link>, wh.get(t.warehouseId),
          <span key="x" className={Number(t.quantity) < 0 ? "text-red-600" : "text-green-700"}>{Number(t.quantity) > 0 ? "+" : ""}{fmtQty(t.quantity)}</span>, fmtMoney(t.unitCost, ""), fmtMoney(t.totalValue, ""), fmtQty(t.balanceAfter), <span key="u" className="text-xs">{users.get(t.userId)}</span>,
        ] }))} />
    </>
  );
}
