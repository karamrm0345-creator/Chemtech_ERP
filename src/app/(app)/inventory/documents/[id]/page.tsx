import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, Card, KeyValues, StatusBadge, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { HistoryPanel } from "@/components/panels";
import { ActionButton } from "@/components/forms/action-button";
import { postStockDocAction, cancelStockDocAction, reverseStockDocAction } from "@/app/actions/inventory";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, humanize } from "@/lib/format";

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("inventory.view");
  const { id } = await params;
  const d = await prisma.stockDocument.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  if (!d) notFound();
  const [items, whs, ledger, people] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: d.lines.map((l) => l.itemId) } }, include: { uom: true } }),
    prisma.warehouse.findMany(),
    prisma.inventoryTransaction.findMany({ where: { refDocType: "StockDocument", refDocId: id }, orderBy: { seq: "asc" } }),
    prisma.user.findMany({ where: { id: { in: [d.createdById, d.postedById, d.reversedById].filter(Boolean) as string[] } }, select: { id: true, name: true } }),
  ]);
  const it = new Map(items.map((i) => [i.id, i]));
  const wh = new Map(whs.map((w) => [w.id, w]));
  const who = (x?: string | null) => people.find((p) => p.id === x)?.name;
  const isAdj = d.type === "ADJUSTMENT" || d.type === "OPENING";
  const canPost = d.status === "DRAFT" && (isAdj ? user.permissions.has("inventory.adjust.approve") && d.createdById !== user.userId : user.permissions.has(d.type === "TRANSFER" ? "inventory.transfer" : "inventory.issue"));
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{d.number} <StatusBadge status={d.status} /></span>} subtitle={humanize(d.type)}
        crumbs={[{ label: "Stock documents", href: "/inventory/documents" }, { label: d.number }]}
        actions={<>
          {canPost && <ActionButton variant="action" label={isAdj ? "Approve & post" : "Post"} confirm="Posting writes to the stock ledger and cannot be edited afterwards. Continue?" action={postStockDocAction.bind(null, id)} />}
          {d.status === "DRAFT" && <ActionButton variant="danger" label="Cancel" confirm="Cancel this draft?" action={cancelStockDocAction.bind(null, id)} />}
          {d.status === "POSTED" && user.permissions.has("inventory.adjust.approve") && <ActionButton variant="outline" label="Reverse" prompt="Reason for reversal" promptRequired confirm="A compensating ledger entry will be posted for every line. The original entries remain." action={reverseStockDocAction.bind(null, id)} />}
        </>} />
      {d.status === "DRAFT" && isAdj && d.createdById === user.userId && <div className="mb-4"><Notice tone="warning">You prepared this document, so another authorised user must approve and post it (separation of duties).</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <KeyValues items={[
              ["Date", fmtDate(d.date)], ["Warehouse", wh.get(d.warehouseId)?.name], ...(d.toWarehouseId ? [["To warehouse", wh.get(d.toWarehouseId)?.name] as [string, string | undefined]] : []),
              ["Reason", d.reason], ["Reference", d.reference], ["Cost centre", d.costCenter], ["Prepared by", who(d.createdById)],
              ["Posted", d.postedAt ? `${fmtDateTime(d.postedAt)} by ${who(d.postedById)}` : "—"], ...(d.reversedById ? [["Reversed by", who(d.reversedById)] as [string, string | undefined]] : []),
            ]} />
          </Card>
          <DataTable basePath={`/inventory/documents/${id}`} columns={[{ label: "#" }, { label: "Item" }, { label: "Quantity", align: "right" }, { label: "Unit cost", align: "right" }, { label: "Batch" }, { label: "Expiry" }, { label: "Serials" }]}
            rows={d.lines.map((l) => ({ key: l.id, cells: [l.lineNo, <Link key="i" className="link" href={`/inventory/items/${l.itemId}`}>{it.get(l.itemId)?.code} — {it.get(l.itemId)?.name}</Link>, `${fmtQty(l.quantity)} ${it.get(l.itemId)?.uom.code ?? ""}`, l.unitCost ? fmtMoney(l.unitCost, "") : "avg", l.batchNo, fmtDate(l.expiryDate), <span key="s" className="text-xs">{l.serialNos}</span>] }))} />
          {ledger.length > 0 && (
            <Card title="Ledger entries" bodyClass="p-0">
              <DataTable basePath={`/inventory/documents/${id}`} columns={[{ label: "Type" }, { label: "Item" }, { label: "WH" }, { label: "Qty", align: "right" }, { label: "Value", align: "right" }, { label: "Balance after", align: "right" }]}
                rows={ledger.map((t) => ({ key: t.id, cells: [humanize(t.type), it.get(t.itemId)?.code, wh.get(t.warehouseId)?.code, fmtQty(t.quantity), fmtMoney(t.totalValue, ""), fmtQty(t.balanceAfter)] }))} />
            </Card>
          )}
        </div>
        <HistoryPanel entity="StockDocument" entityId={id} docType="STOCK_DOCUMENT" />
      </div>
    </>
  );
}
