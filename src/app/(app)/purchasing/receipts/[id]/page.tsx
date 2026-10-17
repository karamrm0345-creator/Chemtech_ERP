import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Notice, Card } from "@/components/ui/primitives";
import { CommercialDocument } from "@/components/document";
import { DataTable } from "@/components/ui/data-table";
import { AttachmentsPanel, HistoryPanel } from "@/components/panels";
import { ActionButton } from "@/components/forms/action-button";
import { PrintButton } from "@/components/print-button";
import { postGrnAction, cancelGrnAction } from "@/app/actions/purchasing";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, humanize } from "@/lib/format";

export default async function GrnPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("purchase.view");
  const { id } = await params;
  const g = await prisma.goodsReceipt.findUnique({ where: { id }, include: { lines: { include: { poLine: true } }, purchaseOrder: true, supplier: true } });
  if (!g) notFound();
  const [items, wh, ledger, poster] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: g.lines.map((l) => l.itemId!).filter(Boolean) } } }),
    prisma.warehouse.findUnique({ where: { id: g.warehouseId } }),
    prisma.inventoryTransaction.findMany({ where: { refDocType: "GoodsReceipt", refDocId: id }, orderBy: { seq: "asc" } }),
    g.postedById ? prisma.user.findUnique({ where: { id: g.postedById }, select: { name: true } }) : null,
  ]);
  const it = new Map(items.map((i) => [i.id, i]));
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{g.number} <StatusBadge status={g.status} /></span>}
        subtitle={<>Against <Link className="link" href={`/purchasing/orders/${g.purchaseOrderId}`}>{g.purchaseOrder.number}</Link> · {g.supplier.legalName}</>}
        crumbs={[{ label: "Goods receipts", href: "/purchasing/receipts" }, { label: g.number }]}
        actions={<>
          {g.status === "DRAFT" && user.permissions.has("purchase.receipt.post") && <ActionButton variant="action" label="Post receipt (add to stock)" confirm="Accepted quantities will be added to stock at landed cost and the purchase order updated. This cannot be edited afterwards. Continue?" action={postGrnAction.bind(null, id)} />}
          {g.status === "DRAFT" && user.permissions.has("purchase.receipt.manage") && <ActionButton variant="danger" label="Cancel" confirm="Cancel this draft receipt?" action={cancelGrnAction.bind(null, id)} />}
          <PrintButton label="Print GRN" />
        </>} />
      {g.status === "POSTED" && <div className="mb-4"><Notice tone="success">Posted {fmtDateTime(g.postedAt)} by {poster?.name}. Stock added to {wh?.code}.</Notice></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <CommercialDocument title="Goods received note" number={g.number} partyLabel="Supplier" showPrices={false} signatures={["Received by (store)", "Inspected by (QA/QC)", "Store manager"]}
            party={{ name: g.supplier.legalName, lines: [g.supplier.address] }}
            meta={[["Date", fmtDate(g.date)], ["Purchase order", g.purchaseOrder.number], ["Delivery note", g.supplierDeliveryNote], ["Warehouse", wh?.code]]}
            lines={g.lines.map((l, i) => ({
              no: i + 1, code: l.itemId ? it.get(l.itemId)?.code : null, description: l.description, qty: l.acceptedQty, uom: l.poLine.uom,
              extra: [Number(l.rejectedQty) > 0 && `Received ${fmtQty(l.receivedQty)}, rejected ${fmtQty(l.rejectedQty)}: ${l.rejectionReason}`, l.batchNo && `Batch ${l.batchNo}`, l.expiryDate && `Exp ${fmtDate(l.expiryDate)}`, l.certificateNo && `Cert ${l.certificateNo}`, l.serialNos && `S/N ${l.serialNos}`].filter(Boolean).join(" · ") || undefined,
            }))} notes={g.notes} />
          {ledger.length > 0 && (
            <Card title="Stock received (ledger, landed cost)" bodyClass="p-0 no-print">
              <DataTable basePath={`/purchasing/receipts/${id}`} columns={[{ label: "Type" }, { label: "Item" }, { label: "Qty", align: "right" }, { label: "Unit cost", align: "right" }, { label: "Value", align: "right" }, { label: "Balance after", align: "right" }]}
                rows={ledger.map((t) => ({ key: t.id, cells: [humanize(t.type), it.get(t.itemId)?.code, fmtQty(t.quantity), fmtMoney(t.unitCost, ""), fmtMoney(t.totalValue, ""), fmtQty(t.balanceAfter)] }))} />
            </Card>
          )}
        </div>
        <div className="no-print space-y-4">
          <AttachmentsPanel user={user} docType="GOODS_RECEIPT" docId={id} title="Delivery note, certificates & inspection reports" />
          <HistoryPanel entity="GoodsReceipt" entityId={id} />
        </div>
      </div>
    </>
  );
}
