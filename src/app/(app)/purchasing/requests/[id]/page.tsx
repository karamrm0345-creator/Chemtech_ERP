import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Scale, PackageCheck } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, LinkButton, StatusBadge, Notice, Card, KeyValues, Badge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { HistoryPanel, AttachmentsPanel } from "@/components/panels";
import { ActionButton } from "@/components/forms/action-button";
import { prActionAction } from "@/app/actions/purchasing";
import { fmtDate, fmtMoney, fmtQty, fmtAmount, humanize } from "@/lib/format";

export default async function PrDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("purchase.view");
  const { id } = await params;
  const pr = await prisma.purchaseRequest.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } }, rfqs: true, orders: true } });
  if (!pr) notFound();
  const [requester, items, so, settings] = await Promise.all([
    prisma.user.findUnique({ where: { id: pr.requestedById }, select: { name: true } }),
    prisma.item.findMany({ where: { id: { in: pr.lines.map((l) => l.itemId!).filter(Boolean) } } }),
    pr.salesOrderId ? prisma.salesOrder.findUnique({ where: { id: pr.salesOrderId }, select: { id: true, number: true } }) : null,
    prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } }),
  ]);
  const it = new Map(items.map((i) => [i.id, i]));
  const P = (p: string) => user.permissions.has(p);
  const act = (a: Parameters<typeof prActionAction>[1]) => prActionAction.bind(null, id, a);
  const orderable = ["APPROVED", "PARTIALLY_ORDERED"].includes(pr.status);
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{pr.number} <StatusBadge status={pr.status} /> {pr.source !== "MANUAL" && <Badge tone="blue">{humanize(pr.source)}</Badge>}</span>}
        subtitle={<>Requested by {requester?.name}{pr.department && ` · ${pr.department}`}</>}
        crumbs={[{ label: "Procurement" }, { label: "Purchase requests", href: "/purchasing/requests" }, { label: pr.number }]}
        actions={<>
          {pr.status === "DRAFT" && P("purchase.request.manage") && <LinkButton variant="outline" href={`/purchasing/requests/${id}/edit`}><Pencil className="h-4 w-4" /> Edit</LinkButton>}
          {pr.status === "DRAFT" && P("purchase.request.manage") && <ActionButton variant="primary" label={settings.requirePrApproval ? "Submit for approval" : "Submit"} action={act("submit")} />}
          {pr.status === "SUBMITTED" && P("purchase.request.approve") && pr.requestedById !== user.userId && <ActionButton variant="action" label="Approve" confirm="Approve this purchase request?" action={act("approve")} />}
          {pr.status === "SUBMITTED" && P("purchase.request.approve") && <ActionButton variant="danger" label="Reject" prompt="Rejection reason" promptRequired action={act("reject")} />}
          {orderable && P("purchase.rfq.manage") && <LinkButton variant="outline" href={`/purchasing/rfqs/new?purchaseRequestId=${id}`}><Scale className="h-4 w-4" /> Request quotations</LinkButton>}
          {orderable && P("purchase.order.manage") && !settings.requireRfq && <LinkButton variant="action" href={`/purchasing/orders/new?purchaseRequestId=${id}`}><PackageCheck className="h-4 w-4" /> Create PO</LinkButton>}
          {["DRAFT", "SUBMITTED", "APPROVED"].includes(pr.status) && (P("purchase.request.manage") || P("purchase.request.approve")) && <ActionButton variant="danger" label="Cancel" confirm="Cancel this request?" action={act("cancel")} />}
        </>} />
      {pr.status === "SUBMITTED" && pr.requestedById === user.userId && <div className="mb-4"><Notice tone="warning">Awaiting approval by another authorised user.</Notice></div>}
      {orderable && settings.requireRfq && <div className="mb-4"><Notice>Company policy requires an RFQ and a selected supplier quotation before a purchase order can be raised.</Notice></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <KeyValues items={[["Date", fmtDate(pr.date)], ["Required by", fmtDate(pr.requiredDate)], ["Cost centre", pr.costCenter], ["Estimated total", fmtMoney(pr.estimatedTotal)],
              ["Linked sales order", so ? <Link className="link" href={`/sales/orders/${so.id}`}>{so.number}</Link> : "—"], ["Approved", pr.approvedAt ? fmtDate(pr.approvedAt) : "—"]]} />
            <div className="mt-3"><p className="label">Justification</p><p className="whitespace-pre-wrap text-sm">{pr.justification}</p></div>
          </Card>
          <DataTable basePath={`/purchasing/requests/${id}`} columns={[{ label: "#" }, { label: "Item / description" }, { label: "Qty", align: "right" }, { label: "Ordered", align: "right" }, { label: "Est. price", align: "right" }, { label: "Est. total", align: "right" }, { label: "Required" }]}
            rows={pr.lines.map((l) => ({ key: l.id, cells: [l.lineNo, <div key="d">{l.itemId && <Link className="link mr-1 font-mono text-xs" href={`/inventory/items/${l.itemId}`}>{it.get(l.itemId)?.code}</Link>}{l.description}</div>, `${fmtQty(l.quantity)} ${l.uom ?? ""}`, fmtQty(l.orderedQty), fmtAmount(l.estimatedUnitPrice), fmtAmount(Number(l.quantity) * Number(l.estimatedUnitPrice)), fmtDate(l.requiredDate)] }))} />
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="RFQs" bodyClass="p-0"><DataTable basePath={`/purchasing/requests/${id}`} empty="None" columns={[{ label: "RFQ" }, { label: "Status" }]} rows={pr.rfqs.map((r) => ({ key: r.id, cells: [<Link key="l" className="link" href={`/purchasing/rfqs/${r.id}`}>{r.number}</Link>, <StatusBadge key="s" status={r.status} />] }))} /></Card>
            <Card title="Purchase orders" bodyClass="p-0"><DataTable basePath={`/purchasing/requests/${id}`} empty="None" columns={[{ label: "PO" }, { label: "Total", align: "right" }, { label: "Status" }]} rows={pr.orders.map((o) => ({ key: o.id, cells: [<Link key="l" className="link" href={`/purchasing/orders/${o.id}`}>{o.number}</Link>, fmtMoney(o.total, o.currency), <StatusBadge key="s" status={o.status} />] }))} /></Card>
          </div>
        </div>
        <div className="space-y-4">
          <AttachmentsPanel user={user} docType="PURCHASE_REQUEST" docId={id} />
          <HistoryPanel entity="PurchaseRequest" entityId={id} docType="PURCHASE_REQUEST" />
        </div>
      </div>
    </>
  );
}
