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
import { postDeliveryAction, cancelDeliveryAction } from "@/app/actions/sales";
import { fmtDate, fmtDateTime, fmtQty, humanize } from "@/lib/format";

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("sales.view");
  const { id } = await params;
  const d = await prisma.deliveryOrder.findUnique({ where: { id }, include: { lines: { include: { salesOrderLine: true } }, salesOrder: true, customer: true } });
  if (!d) notFound();
  const [items, wh, ledger, batches, poster] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: d.lines.map((l) => l.itemId!).filter(Boolean) } } }),
    prisma.warehouse.findUnique({ where: { id: d.warehouseId } }),
    prisma.inventoryTransaction.findMany({ where: { refDocType: "DeliveryOrder", refDocId: id }, orderBy: { seq: "asc" } }),
    prisma.batch.findMany({ where: { itemId: { in: d.lines.map((l) => l.itemId!).filter(Boolean) } } }),
    d.postedById ? prisma.user.findUnique({ where: { id: d.postedById }, select: { name: true } }) : null,
  ]);
  const it = new Map(items.map((i) => [i.id, i]));
  const bt = new Map(batches.map((b) => [b.id, b.batchNo]));
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{d.number} <StatusBadge status={d.status} /></span>}
        subtitle={<>For <Link className="link" href={`/sales/orders/${d.salesOrderId}`}>{d.salesOrder.number}</Link> · {d.customer.legalName}</>}
        crumbs={[{ label: "Deliveries", href: "/sales/deliveries" }, { label: d.number }]}
        actions={<>
          {d.status === "DRAFT" && user.permissions.has("sales.delivery.post") && <ActionButton variant="action" label="Post delivery (issue stock)" confirm="Stock will be issued from the warehouse and the sales order updated. This cannot be edited afterwards. Continue?" action={postDeliveryAction.bind(null, id)} />}
          {d.status === "DRAFT" && user.permissions.has("sales.delivery.manage") && <ActionButton variant="danger" label="Cancel" confirm="Cancel this draft delivery?" action={cancelDeliveryAction.bind(null, id)} />}
          <PrintButton label="Print delivery note" />
        </>} />
      {d.status === "POSTED" && <div className="mb-4"><Notice tone="success">Posted {fmtDateTime(d.postedAt)} by {poster?.name}. Stock issued from {wh?.code}.</Notice></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <CommercialDocument title="Delivery note" number={d.number} partyLabel="Deliver to" showPrices={false} signatures={["Issued by (store)", "Driver", "Received by (customer) — name, sign & stamp"]}
            party={{ name: d.customer.legalName, lines: [d.shippingAddress] }}
            meta={[["Date", fmtDate(d.date)], ["Sales order", d.salesOrder.number], ["Customer PO", d.salesOrder.customerPoRef], ["Warehouse", wh?.code], ["Vehicle", d.vehicleNo], ["Driver", d.driverName]]}
            lines={d.lines.map((l, i) => {
              const rows = ledger.filter((t) => t.refLineId === l.id);
              const trace = rows.map((t) => [t.batchId && `Batch ${bt.get(t.batchId)} × ${fmtQty(Math.abs(Number(t.quantity)))}`, t.serialNos && `S/N ${t.serialNos}`].filter(Boolean).join(" · ")).filter(Boolean).join("; ");
              return { no: i + 1, code: l.itemId ? it.get(l.itemId)?.code : null, description: l.description, qty: l.quantity, uom: l.salesOrderLine.uom, extra: trace || (l.batchNo ? `Batch ${l.batchNo}` : l.serialNos ? `S/N ${l.serialNos}` : undefined) };
            })} notes={d.notes} />
          {ledger.length > 0 && (
            <Card title="Stock issued (ledger)" bodyClass="p-0 no-print">
              <DataTable basePath={`/sales/deliveries/${id}`} columns={[{ label: "Type" }, { label: "Item" }, { label: "Batch" }, { label: "Qty", align: "right" }, { label: "Balance after", align: "right" }]}
                rows={ledger.map((t) => ({ key: t.id, cells: [humanize(t.type), it.get(t.itemId)?.code, t.batchId ? bt.get(t.batchId) : "", fmtQty(t.quantity), fmtQty(t.balanceAfter)] }))} />
            </Card>
          )}
        </div>
        <div className="no-print space-y-4">
          <AttachmentsPanel user={user} docType="DELIVERY_ORDER" docId={id} title="Signed delivery note & documents" />
          <HistoryPanel entity="DeliveryOrder" entityId={id} />
        </div>
      </div>
    </>
  );
}
