import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Truck, Receipt } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { orderAvailability } from "@/server/services/sales";
import { PageHeader, LinkButton, StatusBadge, Notice, Card, KeyValues } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { AttachmentsPanel, HistoryPanel } from "@/components/panels";
import { ActionButton } from "@/components/forms/action-button";
import { PrintButton } from "@/components/print-button";
import { salesOrderActionAction, reserveAction, releaseAction, shortagePrAction } from "@/app/actions/sales";
import { fmtDate, fmtMoney, fmtQty, fmtAmount } from "@/lib/format";
import { D } from "@/lib/decimal";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("sales.view");
  const { id } = await params;
  const so = await prisma.salesOrder.findUnique({ where: { id }, include: { customer: true, contact: true, quotation: true, lines: { orderBy: { lineNo: "asc" } }, deliveries: { orderBy: { date: "desc" } }, invoices: { orderBy: { date: "desc" } } } });
  if (!so) notFound();
  const [av, items, wh, creator, prs, settings] = await Promise.all([
    orderAvailability(prisma, id),
    prisma.item.findMany({ where: { id: { in: so.lines.map((l) => l.itemId!).filter(Boolean) } }, include: { uom: true } }),
    prisma.warehouse.findUnique({ where: { id: so.warehouseId } }),
    prisma.user.findUnique({ where: { id: so.createdById }, select: { name: true } }),
    prisma.purchaseRequest.findMany({ where: { salesOrderId: id }, select: { id: true, number: true, status: true } }),
    prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } }),
  ]);
  const it = new Map(items.map((i) => [i.id, i]));
  const P = (p: string) => user.permissions.has(p);
  const act = (a: Parameters<typeof salesOrderActionAction>[1]) => salesOrderActionAction.bind(null, id, a);
  const open = ["APPROVED", "PARTIALLY_DELIVERED"].includes(so.status);
  const shortage = av.some((a) => a.stocked && a.shortage.gt(0));
  const anyReserved = av.some((a) => a.reservedForLine.gt(0));
  const needsReserve = open && av.some((a) => a.stocked && a.outstanding.sub(a.reservedForLine).gt(0) && a.available.gt(0));
  const invoiced = so.lines.reduce((s, l) => s.add(D(l.invoicedQty).mul(D(l.unitPrice)).mul(D(1).sub(D(l.discountPct).div(100)))), D(0));
  return (
    <>
      <PageHeader title={<span className="flex flex-wrap items-center gap-2">{so.number} <StatusBadge status={so.status} /></span>}
        subtitle={<><Link className="hover:text-brand-600" href={`/customers/${so.customerId}`}>{so.customer.legalName}</Link> · prepared by {creator?.name}</>}
        crumbs={[{ label: "Sales" }, { label: "Sales orders", href: "/sales/orders" }, { label: so.number }]}
        actions={<>
          {so.status === "DRAFT" && P("sales.order.manage") && <LinkButton variant="outline" href={`/sales/orders/${id}/edit`}><Pencil className="h-4 w-4" /> Edit</LinkButton>}
          {so.status === "DRAFT" && P("sales.order.manage") && <ActionButton variant="primary" label="Submit for approval" action={act("submit")} />}
          {so.status === "SUBMITTED" && P("sales.order.approve") && so.createdById !== user.userId && <ActionButton variant="action" label="Approve" confirm="Approve this sales order?" action={act("approve")} />}
          {so.status === "SUBMITTED" && P("sales.order.approve") && <ActionButton label="Return to draft" prompt="Reason" promptRequired action={act("returnToDraft")} />}
          {needsReserve && P("sales.reserve") && <ActionButton variant="primary" label="Reserve stock" action={reserveAction.bind(null, id)} />}
          {anyReserved && P("sales.reserve") && <ActionButton label="Release reservations" confirm="Release all stock reserved for this order?" action={releaseAction.bind(null, id)} />}
          {open && P("sales.delivery.manage") && <LinkButton variant="action" href={`/sales/deliveries/new?salesOrderId=${id}`}><Truck className="h-4 w-4" /> Create delivery</LinkButton>}
          {settings.financeEnabled && ["APPROVED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED"].includes(so.status) && P("finance.sales.manage") && <LinkButton variant="outline" href={`/finance/sales-invoices/new?salesOrderId=${id}`}><Receipt className="h-4 w-4" /> Invoice</LinkButton>}
          {open && P("sales.order.approve") && <ActionButton label="Close (short-close)" prompt="Reason for closing with undelivered quantities" promptRequired action={act("close")} />}
          {["DRAFT", "SUBMITTED", "APPROVED"].includes(so.status) && (P("sales.order.manage") || P("sales.order.approve")) && <ActionButton variant="danger" label="Cancel" confirm="Cancel this order? Reservations are released." action={act("cancel")} />}
          <PrintButton />
        </>} />
      <div className="mb-4 space-y-2">
        {so.status === "SUBMITTED" && so.createdById === user.userId && <Notice tone="warning">Awaiting approval by another authorised user.</Notice>}
        {open && shortage && (
          <Notice tone="warning">
            <span className="font-semibold">Insufficient stock</span> at {wh?.code} for some lines (see Shortage column).
            {P("purchase.request.manage") && <span className="ml-2 inline-block"><ActionButton label="Create purchase request for shortage" redirectBase="/purchasing/requests" action={shortagePrAction.bind(null, id)} /></span>}
          </Notice>
        )}
        {prs.length > 0 && <Notice>Linked purchase requests: {prs.map((p) => <Link key={p.id} className="link mr-2" href={`/purchasing/requests/${p.id}`}>{p.number} ({p.status.toLowerCase()})</Link>)}</Notice>}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <KeyValues cols={4} items={[
              ["Order date", fmtDate(so.date)], ["Required", fmtDate(so.requiredDate)], ["Customer PO", so.customerPoRef], ["Warehouse", wh ? `${wh.code} — ${wh.name}` : ""],
              ["Contact", so.contact?.name], ["Payment terms", so.paymentTerms], ["Delivery terms", so.deliveryTerms],
              ["From quotation", so.quotation ? <Link className="link" href={`/sales/quotations/${so.quotation.id}`}>{so.quotation.number}</Link> : "—"],
              ["Order total", <b key="t">{fmtMoney(so.total, so.currency)}</b>], ["Invoiced (net)", fmtMoney(invoiced, so.currency)], ["Shipping address", so.shippingAddress],
            ]} />
          </Card>
          <Card title="Lines, availability & fulfilment" bodyClass="p-0">
            <DataTable basePath={`/sales/orders/${id}`} columns={[{ label: "#" }, { label: "Item / description" }, { label: "Ordered", align: "right" }, { label: "Delivered", align: "right" }, { label: "Reserved", align: "right" }, { label: "Available", align: "right" }, { label: "Shortage", align: "right" }, { label: "Unit price", align: "right" }, { label: "Net", align: "right" }]}
              rows={so.lines.map((l) => {
                const a = av.find((x) => x.lineId === l.id)!;
                const item = l.itemId ? it.get(l.itemId) : undefined;
                return { key: l.id, cells: [
                  l.lineNo,
                  <div key="d">{item && <Link className="link mr-1 font-mono text-xs" href={`/inventory/items/${item.id}`}>{item.code}</Link>}{l.description}{!a.stocked && <span className="ml-1 text-xs text-ink-muted">(service / non-stock)</span>}</div>,
                  `${fmtQty(l.quantity)} ${l.uom ?? ""}`, fmtQty(l.deliveredQty),
                  a.stocked ? fmtQty(a.reservedForLine) : "—", a.stocked ? fmtQty(a.available) : "—",
                  a.stocked && a.shortage.gt(0) && open ? <b key="s" className="text-red-600">{fmtQty(a.shortage)}</b> : "—",
                  fmtAmount(l.unitPrice), fmtAmount(l.lineTotal),
                ] };
              })}
              footer={<tfoot><tr><td colSpan={8} className="text-right text-ink-soft">Subtotal / discount / tax</td><td className="num">{fmtAmount(D(so.subtotal).sub(D(so.discountTotal)))} / {fmtAmount(so.taxTotal)}</td></tr><tr><td colSpan={8} className="text-right font-bold">Total</td><td className="num font-bold">{so.currency} {fmtAmount(so.total)}</td></tr></tfoot>} />
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Deliveries" bodyClass="p-0">
              <DataTable basePath={`/sales/orders/${id}`} empty="No deliveries" columns={[{ label: "Delivery" }, { label: "Date" }, { label: "Status" }]}
                rows={so.deliveries.map((d) => ({ key: d.id, cells: [<Link key="l" className="link" href={`/sales/deliveries/${d.id}`}>{d.number}</Link>, fmtDate(d.date), <StatusBadge key="s" status={d.status} />] }))} />
            </Card>
            <Card title="Invoices" bodyClass="p-0">
              <DataTable basePath={`/sales/orders/${id}`} empty="Not invoiced" columns={[{ label: "Invoice" }, { label: "Total", align: "right" }, { label: "Status" }]}
                rows={so.invoices.map((i) => ({ key: i.id, cells: [P("finance.view") ? <Link key="l" className="link" href={`/finance/sales-invoices/${i.id}`}>{i.number}</Link> : i.number, fmtMoney(i.total, i.currency), <StatusBadge key="s" status={i.status} />] }))} />
            </Card>
          </div>
          {so.notes && <Card title="Notes"><p className="whitespace-pre-wrap text-sm">{so.notes}</p></Card>}
        </div>
        <div className="no-print space-y-4">
          <AttachmentsPanel user={user} docType="SALES_ORDER" docId={id} />
          <HistoryPanel entity="SalesOrder" entityId={id} docType="SALES_ORDER" />
        </div>
      </div>
    </>
  );
}
