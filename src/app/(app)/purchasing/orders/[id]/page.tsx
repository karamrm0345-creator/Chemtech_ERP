import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, PackageOpen, Undo2, Receipt } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, LinkButton, StatusBadge, Notice, Card } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { CommercialDocument } from "@/components/document";
import { AttachmentsPanel, HistoryPanel } from "@/components/panels";
import { ActionButton } from "@/components/forms/action-button";
import { PrintButton } from "@/components/print-button";
import { poActionAction } from "@/app/actions/purchasing";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/format";
import { D } from "@/lib/decimal";

export default async function PoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("purchase.view");
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, lines: { orderBy: { lineNo: "asc" } }, receipts: { orderBy: { date: "desc" } }, invoices: true, supplierQuotation: true, purchaseRequest: true } });
  if (!po) notFound();
  const [items, wh, creator, approver, returns, settings] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: po.lines.map((l) => l.itemId!).filter(Boolean) } } }),
    prisma.warehouse.findUnique({ where: { id: po.warehouseId } }),
    prisma.user.findUnique({ where: { id: po.createdById }, select: { name: true } }),
    po.approvedById ? prisma.user.findUnique({ where: { id: po.approvedById }, select: { name: true } }) : null,
    prisma.purchaseReturn.findMany({ where: { purchaseOrderId: id }, orderBy: { date: "desc" } }),
    prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } }),
  ]);
  const code = new Map(items.map((i) => [i.id, i.code]));
  const P = (p: string) => user.permissions.has(p);
  const act = (a: Parameters<typeof poActionAction>[1]) => poActionAction.bind(null, id, a);
  const receivable = ["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status);
  const late = receivable && po.expectedDate && po.expectedDate < new Date();
  const hasReceived = po.lines.some((l) => D(l.receivedQty).sub(D(l.returnedQty)).gt(0));
  return (
    <>
      <PageHeader title={<span className="flex flex-wrap items-center gap-2">{po.number} <StatusBadge status={po.status} /></span>}
        subtitle={<><Link className="hover:text-brand-600" href={`/suppliers/${po.supplierId}`}>{po.supplier.legalName}</Link> · prepared by {creator?.name}{approver && ` · approved by ${approver.name}`}</>}
        crumbs={[{ label: "Procurement" }, { label: "Purchase orders", href: "/purchasing/orders" }, { label: po.number }]}
        actions={<>
          {["DRAFT", "REJECTED"].includes(po.status) && P("purchase.order.manage") && <LinkButton variant="outline" href={`/purchasing/orders/${id}/edit`}><Pencil className="h-4 w-4" /> Edit</LinkButton>}
          {po.status === "DRAFT" && P("purchase.order.manage") && <ActionButton variant="primary" label="Submit for approval" action={act("submit")} />}
          {po.status === "SUBMITTED" && P("purchase.order.approve") && po.createdById !== user.userId && <ActionButton variant="action" label="Approve" confirm="Approve this purchase order?" action={act("approve")} />}
          {po.status === "SUBMITTED" && P("purchase.order.approve") && <ActionButton variant="danger" label="Reject" prompt="Rejection reason" promptRequired action={act("reject")} />}
          {receivable && P("purchase.receipt.manage") && <LinkButton variant="action" href={`/purchasing/receipts/new?purchaseOrderId=${id}`}><PackageOpen className="h-4 w-4" /> Receive goods</LinkButton>}
          {hasReceived && P("purchase.return.manage") && <LinkButton variant="outline" href={`/purchasing/returns/new?purchaseOrderId=${id}`}><Undo2 className="h-4 w-4" /> Return to supplier</LinkButton>}
          {settings.financeEnabled && hasReceived && P("finance.purchase.manage") && <LinkButton variant="outline" href={`/finance/purchase-invoices/new?purchaseOrderId=${id}`}><Receipt className="h-4 w-4" /> Record invoice</LinkButton>}
          {receivable && P("purchase.order.approve") && <ActionButton label="Close (short-close)" prompt="Reason for closing with outstanding quantities" promptRequired action={act("close")} />}
          {["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"].includes(po.status) && (P("purchase.order.manage") || P("purchase.order.approve")) && <ActionButton variant="danger" label="Cancel" confirm="Cancel this purchase order?" action={act("cancel")} />}
          <PrintButton />
        </>} />
      <div className="mb-4 space-y-2">
        {po.status === "SUBMITTED" && po.createdById === user.userId && <Notice tone="warning">Awaiting approval by another authorised user.</Notice>}
        {late && <Notice tone="danger">Delivery is overdue: expected {fmtDate(po.expectedDate)}.</Notice>}
        {!po.allowPartial && <Notice>Partial deliveries are <b>not</b> allowed on this order.</Notice>}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <CommercialDocument title="Purchase order" number={po.number} partyLabel="Supplier"
            party={{ name: po.supplier.legalName, lines: [po.supplier.address, [po.supplier.city, po.supplier.country].filter(Boolean).join(", "), po.supplier.email, po.supplier.phone] }}
            meta={[["Order date", fmtDate(po.date)], ["Expected", fmtDate(po.expectedDate)], ["Deliver to", wh ? `${wh.name}` : ""], ["Your quote", po.supplierQuoteRef ?? po.supplierQuotation?.supplierRef], ["Payment", po.paymentTerms], ["Delivery", po.deliveryTerms], ["Currency", po.currency], ["Our PR", po.purchaseRequest?.number]]}
            lines={po.lines.map((l) => ({ no: l.lineNo, code: l.itemId ? code.get(l.itemId) : null, description: l.description, qty: l.quantity, uom: l.uom, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate, total: l.lineTotal }))}
            currency={po.currency} signatures={["Prepared by", "Approved by", "Supplier acceptance"]}
            totals={[["Subtotal", D(po.subtotal).sub(D(po.discountTotal))], ["Tax", po.taxTotal], ["Freight", po.freight], ["Other charges", po.otherCharges], ["Total", po.total]]} notes={po.notes} />
          <Card title="Receipt progress" bodyClass="p-0 no-print">
            <DataTable basePath={`/purchasing/orders/${id}`} columns={[{ label: "#" }, { label: "Description" }, { label: "Ordered", align: "right" }, { label: "Received", align: "right" }, { label: "Returned", align: "right" }, { label: "Outstanding", align: "right" }, { label: "Invoiced", align: "right" }]}
              rows={po.lines.map((l) => {
                const out = D(l.quantity).sub(D(l.receivedQty)).add(D(l.returnedQty));
                return { key: l.id, cells: [l.lineNo, l.description, fmtQty(l.quantity), fmtQty(l.receivedQty), fmtQty(l.returnedQty), <b key="o" className={out.gt(0) ? "text-amber-700" : "text-green-700"}>{fmtQty(out.gt(0) ? out : 0)}</b>, fmtQty(l.invoicedQty)] };
              })} />
          </Card>
          <div className="no-print grid gap-4 md:grid-cols-3">
            <Card title="Goods receipts" bodyClass="p-0"><DataTable basePath={`/purchasing/orders/${id}`} empty="None" columns={[{ label: "GRN" }, { label: "Date" }, { label: "Status" }]} rows={po.receipts.map((g) => ({ key: g.id, cells: [<Link key="l" className="link" href={`/purchasing/receipts/${g.id}`}>{g.number}</Link>, fmtDate(g.date), <StatusBadge key="s" status={g.status} />] }))} /></Card>
            <Card title="Returns" bodyClass="p-0"><DataTable basePath={`/purchasing/orders/${id}`} empty="None" columns={[{ label: "Return" }, { label: "Date" }]} rows={returns.map((r) => ({ key: r.id, cells: [<Link key="l" className="link" href={`/purchasing/returns/${r.id}`}>{r.number}</Link>, fmtDate(r.date)] }))} /></Card>
            <Card title="Supplier invoices" bodyClass="p-0"><DataTable basePath={`/purchasing/orders/${id}`} empty="None" columns={[{ label: "Invoice" }, { label: "Total", align: "right" }, { label: "Status" }]} rows={po.invoices.map((i) => ({ key: i.id, cells: [P("finance.view") ? <Link key="l" className="link" href={`/finance/purchase-invoices/${i.id}`}>{i.number}</Link> : i.number, fmtMoney(i.total, i.currency), <StatusBadge key="s" status={i.status} />] }))} /></Card>
          </div>
        </div>
        <div className="no-print space-y-4">
          <AttachmentsPanel user={user} docType="PURCHASE_ORDER" docId={id} />
          <HistoryPanel entity="PurchaseOrder" entityId={id} docType="PURCHASE_ORDER" />
        </div>
      </div>
    </>
  );
}
