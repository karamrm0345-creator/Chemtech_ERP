import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { getItem } from "@/server/services/items";
import { itemStockPosition } from "@/server/services/inventory";
import { PageHeader, Card, KeyValues, LinkButton, StatusBadge, Badge, Tabs, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { AttachmentsPanel, HistoryPanel } from "@/components/panels";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, humanize } from "@/lib/format";
import { D, ZERO } from "@/lib/decimal";
import { INVENTORY_CLASS_LABEL } from "@/lib/options";
import { RefLink } from "@/components/ref-link";

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("item.view");
  const { id } = await params;
  const { tab = "stock" } = await searchParams;
  const item = await getItem(user, id).catch(() => null);
  if (!item) notFound();
  const canInv = user.permissions.has("inventory.view");
  const stocked = item.itemType !== "SERVICE" && item.inventoryClass !== "NON_STOCK";
  const [position, ledger, reservations, poLines, serials, whs] = await Promise.all([
    stocked ? itemStockPosition(id) : [],
    canInv ? prisma.inventoryTransaction.findMany({ where: { itemId: id }, orderBy: { seq: "desc" }, take: 200 }) : [],
    prisma.stockReservation.findMany({ where: { itemId: id, status: "ACTIVE" }, include: { salesOrderLine: { include: { order: { include: { customer: true } } } } } }),
    prisma.purchaseOrderLine.findMany({ where: { itemId: id, order: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } } }, include: { order: { include: { supplier: true } } } }),
    item.serialTracked ? prisma.serialNumber.findMany({ where: { itemId: id }, orderBy: { serialNo: "asc" } }) : [],
    prisma.warehouse.findMany(),
  ]);
  const wh = new Map(whs.map((w) => [w.id, w.code]));
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(ledger.map((l) => l.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const batches = new Map((await prisma.batch.findMany({ where: { itemId: id } })).map((b) => [b.id, b]));
  const tot = position.reduce((t, p) => ({ onHand: t.onHand.add(p.onHand), reserved: t.reserved.add(p.reserved), available: t.available.add(p.available), onOrder: t.onOrder.add(p.onOrder) }), { onHand: ZERO, reserved: ZERO, available: ZERO, onOrder: ZERO });
  const status = !stocked ? "NON_STOCK" : tot.onHand.lte(0) ? "OUT" : D(item.minStockLevel).gt(0) && tot.onHand.lte(item.minStockLevel) ? "LOW" : "OK";
  const base = `/inventory/items/${id}`;
  const tabs = [
    { key: "stock", label: "Stock position", href: base },
    ...(canInv && stocked ? [{ key: "card", label: "Stock card (ledger)", href: `${base}?tab=card`, count: ledger.length }] : []),
    ...(item.serialTracked ? [{ key: "serials", label: "Serial numbers", href: `${base}?tab=serials`, count: serials.length }] : []),
    { key: "documents", label: "SDS, datasheets & history", href: `${base}?tab=documents` },
  ];
  return (
    <>
      <PageHeader title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{item.code}</span> <StatusBadge status={item.active ? status : "INACTIVE"} label={status === "NON_STOCK" ? "Service / non-stock" : undefined} /> {item.hazardous && <Badge tone="red">HAZARDOUS</Badge>} {item.isDemo && <Badge tone="amber">DEMO</Badge>}</span>}
        subtitle={item.name} crumbs={[{ label: "Items", href: "/inventory/items" }, { label: item.code }]}
        actions={<>
          {stocked && user.permissions.has("purchase.request.manage") && <LinkButton variant="outline" href={`/purchasing/requests/new?itemId=${id}`}><Plus className="h-4 w-4" /> Purchase request</LinkButton>}
          {stocked && user.permissions.has("inventory.adjust") && <LinkButton variant="outline" href={`/inventory/documents/new?type=ADJUSTMENT&itemId=${id}`}>Adjust stock</LinkButton>}
          {user.permissions.has("item.manage") && <LinkButton href={`${base}/edit`}><Pencil className="h-4 w-4" /> Edit</LinkButton>}
        </>} />

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Item details" className="lg:col-span-2">
          <KeyValues items={[
            ["Type", humanize(item.itemType)], ["Control", INVENTORY_CLASS_LABEL[item.inventoryClass]], ["Category", item.category?.name], ["UoM", item.uom.code],
            ["Manufacturer", item.manufacturer], ["Mfr part no.", item.manufacturerPartNo], ["Supplier part no.", item.supplierPartNo],
            ["Preferred supplier", item.preferredSupplier ? <Link className="link" href={`/suppliers/${item.preferredSupplier.id}`}>{item.preferredSupplier.legalName}</Link> : null],
            ["Default location", [item.defaultWarehouse?.code, item.defaultLocation?.code].filter(Boolean).join(" / ") || null],
            ["Tracking", [item.batchTracked && "Batch", item.expiryTracked && "Expiry", item.serialTracked && "Serial"].filter(Boolean).join(", ") || "Quantity only"],
          ]} />
          {item.description && <p className="mt-3 whitespace-pre-wrap text-sm text-ink-soft">{item.description}</p>}
        </Card>
        <Card title="Quantities & value">
          {stocked ? (
            <dl className="space-y-2 text-sm">
              {[["On hand (physical)", tot.onHand], ["Reserved for orders", tot.reserved], ["Available", tot.available], ["On order (open POs)", tot.onOrder]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between"><dt className="text-ink-soft">{k as string}</dt><dd className="font-semibold tabular-nums">{fmtQty(v as never)} {item.uom.code}</dd></div>
              ))}
              <div className="flex justify-between border-t border-line pt-2"><dt className="text-ink-soft">Minimum / reorder qty</dt><dd className="tabular-nums">{fmtQty(item.minStockLevel)} / {fmtQty(item.reorderQty)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Weighted avg cost</dt><dd className="tabular-nums">{fmtMoney(item.avgCost)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Stock value</dt><dd className="font-bold tabular-nums">{fmtMoney(tot.onHand.mul(D(item.avgCost)))}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Selling price</dt><dd className="tabular-nums">{fmtMoney(item.sellingPrice)}</dd></div>
            </dl>
          ) : <p className="text-sm text-ink-muted">Service item: no stock movements. Selling price {fmtMoney(item.sellingPrice)}.</p>}
        </Card>
      </div>
      <Tabs tabs={tabs} active={tab} />

      {tab === "stock" && stocked && (
        <div className="space-y-4">
          <DataTable basePath={base} empty="No stock in any warehouse"
            columns={[{ label: "Warehouse" }, { label: "On hand", align: "right" }, { label: "Reserved", align: "right" }, { label: "Available", align: "right" }, { label: "On order", align: "right" }, { label: "Lots / batches" }]}
            rows={position.map((p) => ({ key: p.warehouse.id, cells: [
              `${p.warehouse.code} — ${p.warehouse.name}`, fmtQty(p.onHand), fmtQty(p.reserved), <b key="a">{fmtQty(p.available)}</b>, fmtQty(p.onOrder),
              <div key="l" className="space-y-0.5 text-xs">{p.lots.filter((l) => l.batch).map((l) => (
                <div key={l.id}>{l.batch!.batchNo}: {fmtQty(l.quantity)}{l.batch!.expiryDate && <span className={l.batch!.expiryDate < new Date() ? " font-semibold text-red-600" : " text-ink-muted"}> · exp {fmtDate(l.batch!.expiryDate)}</span>}</div>
              ))}</div>,
            ] }))} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Active reservations" bodyClass="p-0">
              <DataTable basePath={base} empty="No reservations" columns={[{ label: "Sales order" }, { label: "Customer" }, { label: "WH" }, { label: "Qty", align: "right" }]}
                rows={reservations.map((r) => ({ key: r.id, cells: [<Link key="o" className="link" href={`/sales/orders/${r.salesOrderLine.orderId}`}>{r.salesOrderLine.order.number}</Link>, r.salesOrderLine.order.customer.legalName, wh.get(r.warehouseId), fmtQty(r.quantity)] }))} />
            </Card>
            <Card title="Open purchase orders" bodyClass="p-0">
              <DataTable basePath={base} empty="Nothing on order" columns={[{ label: "PO" }, { label: "Supplier" }, { label: "Expected" }, { label: "Outstanding", align: "right" }]}
                rows={poLines.map((l) => ({ key: l.id, cells: [<Link key="o" className="link" href={`/purchasing/orders/${l.orderId}`}>{l.order.number}</Link>, l.order.supplier.legalName, fmtDate(l.order.expectedDate), fmtQty(D(l.quantity).sub(D(l.receivedQty)).add(D(l.returnedQty)))] }))} />
            </Card>
          </div>
        </div>
      )}
      {tab === "stock" && !stocked && <Notice>This is a service / non-stock item. It can be quoted, ordered and invoiced, but it has no stock position.</Notice>}

      {tab === "card" && (
        <DataTable basePath={base} empty="No movements yet"
          columns={[{ label: "Date" }, { label: "Type" }, { label: "Reference" }, { label: "WH" }, { label: "Batch / serials" }, { label: "In", align: "right" }, { label: "Out", align: "right" }, { label: "Balance (WH)", align: "right" }, { label: "Unit cost", align: "right" }, { label: "User" }]}
          rows={ledger.map((t) => ({ key: t.id, cells: [
            <span key="d" className="whitespace-nowrap text-xs">{fmtDateTime(t.txnDate)}</span>, <span key="t" className="text-xs">{humanize(t.type)}</span>,
            <RefLink key="r" type={t.refDocType} id={t.refDocId} no={t.refDocNo} />, wh.get(t.warehouseId),
            <span key="b" className="text-xs">{t.batchId ? batches.get(t.batchId)?.batchNo : ""}{t.serialNos ? ` ${t.serialNos}` : ""}</span>,
            D(t.quantity).gt(0) ? fmtQty(t.quantity) : "", D(t.quantity).lt(0) ? fmtQty(D(t.quantity).abs()) : "", fmtQty(t.balanceAfter), fmtMoney(t.unitCost, ""), users.get(t.userId),
          ] }))} />
      )}
      {tab === "serials" && (
        <DataTable basePath={base} empty="No serial numbers recorded"
          columns={[{ label: "Serial no." }, { label: "Status" }, { label: "Warehouse" }, { label: "Certificate" }, { label: "Next inspection" }]}
          rows={serials.map((s) => ({ key: s.id, cells: [<span key="s" className="font-mono">{s.serialNo}</span>, <StatusBadge key="st" status={s.status} />, s.warehouseId ? wh.get(s.warehouseId) : "—", s.certificateNo, fmtDate(s.nextInspectionDate)] }))} />
      )}
      {tab === "documents" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AttachmentsPanel user={user} docType="ITEM" docId={id} title="SDS, technical datasheets & certificates" />
          <HistoryPanel entity="Item" entityId={id} />
        </div>
      )}
    </>
  );
}

