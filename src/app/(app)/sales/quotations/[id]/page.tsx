import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, LinkButton, StatusBadge, Notice } from "@/components/ui/primitives";
import { CommercialDocument } from "@/components/document";
import { AttachmentsPanel, HistoryPanel } from "@/components/panels";
import { ActionButton } from "@/components/forms/action-button";
import { QuickFormButton } from "@/components/forms/small-forms";
import { PrintButton } from "@/components/print-button";
import { quotationActionAction, reviseQuotationAction, convertQuotationFormAction } from "@/app/actions/sales";
import { fmtDate } from "@/lib/format";

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("sales.view");
  const { id } = await params;
  const q = await prisma.salesQuotation.findUnique({ where: { id }, include: { customer: true, contact: true, lines: { orderBy: { lineNo: "asc" } }, salesOrder: true } });
  if (!q) notFound();
  const [items, whs, creator, parent, children] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: q.lines.map((l) => l.itemId!).filter(Boolean) } } }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.user.findUnique({ where: { id: q.createdById }, select: { name: true } }),
    q.parentId ? prisma.salesQuotation.findUnique({ where: { id: q.parentId }, select: { id: true, number: true } }) : null,
    prisma.salesQuotation.findMany({ where: { parentId: q.id }, select: { id: true, number: true } }),
  ]);
  const code = new Map(items.map((i) => [i.id, i.code]));
  const P = (p: string) => user.permissions.has(p);
  const act = (a: Parameters<typeof quotationActionAction>[1]) => quotationActionAction.bind(null, id, a);
  const expired = q.validUntil && q.validUntil < new Date() && ["APPROVED", "SENT"].includes(q.status);
  return (
    <>
      <PageHeader title={<span className="flex flex-wrap items-center gap-2">{q.number} <StatusBadge status={q.status} /></span>}
        subtitle={<>{q.customer.legalName} · prepared by {creator?.name}</>}
        crumbs={[{ label: "Sales" }, { label: "Quotations", href: "/sales/quotations" }, { label: q.number }]}
        actions={<>
          {q.status === "DRAFT" && P("sales.quotation.manage") && <LinkButton variant="outline" href={`/sales/quotations/${id}/edit`}><Pencil className="h-4 w-4" /> Edit</LinkButton>}
          {q.status === "DRAFT" && P("sales.quotation.manage") && <ActionButton variant="primary" label="Submit for approval" action={act("submit")} />}
          {q.status === "SUBMITTED" && P("sales.quotation.approve") && q.createdById !== user.userId && <ActionButton variant="action" label="Approve" action={act("approve")} confirm="Approve this quotation?" />}
          {q.status === "SUBMITTED" && P("sales.quotation.approve") && <ActionButton label="Return to draft" prompt="Reason" promptRequired action={act("returnToDraft")} />}
          {q.status === "APPROVED" && P("sales.quotation.manage") && <ActionButton variant="primary" label="Mark as sent" action={act("send")} />}
          {["SENT", "APPROVED"].includes(q.status) && P("sales.quotation.manage") && <ActionButton variant="action" label="Customer accepted" action={act("accept")} confirm="Record customer acceptance?" />}
          {["SENT", "APPROVED"].includes(q.status) && P("sales.quotation.manage") && <ActionButton label="Customer rejected" prompt="Reason (optional)" action={act("reject")} />}
          {q.status === "ACCEPTED" && P("sales.order.manage") && <QuickFormButton variant="action" label="Convert to sales order" title="Convert to sales order" redirectBase="/sales/orders"
            note="A draft sales order is created with the same lines and prices, linked to this quotation."
            action={convertQuotationFormAction.bind(null, id)} fields={[{ name: "warehouseId", label: "Fulfilment warehouse", type: "select", required: true, options: whs.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })) }]} />}
          {["SUBMITTED", "APPROVED", "SENT", "REJECTED"].includes(q.status) && P("sales.quotation.manage") && <ActionButton label="Revise" redirectBase="/sales/quotations" confirm="Create a new draft revision? This version will be marked as revised." action={reviseQuotationAction.bind(null, id)} />}
          {["DRAFT", "SUBMITTED", "APPROVED", "SENT"].includes(q.status) && P("sales.quotation.manage") && <ActionButton variant="danger" label="Cancel" confirm="Cancel this quotation?" action={act("cancel")} />}
          <PrintButton />
        </>} />
      <div className="mb-4 space-y-2">
        {q.status === "SUBMITTED" && q.createdById === user.userId && <Notice tone="warning">Awaiting approval by another authorised user (you prepared this quotation).</Notice>}
        {expired && <Notice tone="warning">This quotation passed its validity date ({fmtDate(q.validUntil)}). Consider revising it before acceptance.</Notice>}
        {q.salesOrder && <Notice tone="success">Converted to sales order <Link className="link" href={`/sales/orders/${q.salesOrder.id}`}>{q.salesOrder.number}</Link>.</Notice>}
        {(parent || children.length > 0) && <Notice>Revisions: {parent && <>previous <Link className="link" href={`/sales/quotations/${parent.id}`}>{parent.number}</Link></>} {children.map((c) => <span key={c.id}> · newer <Link className="link" href={`/sales/quotations/${c.id}`}>{c.number}</Link></span>)}</Notice>}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <CommercialDocument title="Quotation" number={q.number} partyLabel="Customer"
            party={{ name: q.customer.legalName, lines: [q.contact && `Attn: ${q.contact.name}`, q.customer.address, [q.customer.city, q.customer.country].filter(Boolean).join(", "), q.customer.email] }}
            meta={[["Date", fmtDate(q.date)], ["Valid until", fmtDate(q.validUntil)], ["Your ref.", q.reference], ["Payment", q.paymentTerms], ["Delivery", q.deliveryTerms], ["Currency", q.currency]]}
            lines={q.lines.map((l) => ({ no: l.lineNo, code: l.itemId ? code.get(l.itemId) : null, description: l.description, qty: l.quantity, uom: l.uom, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate, total: l.lineTotal }))}
            currency={q.currency} totals={[["Subtotal", q.subtotal], ["Discount", Number(q.discountTotal) ? -Number(q.discountTotal) : 0], ["Tax", q.taxTotal], ["Total", q.total]]} notes={q.notes} />
        </div>
        <div className="no-print space-y-4">
          <AttachmentsPanel user={user} docType="SALES_QUOTATION" docId={id} />
          <HistoryPanel entity="SalesQuotation" entityId={id} docType="SALES_QUOTATION" />
        </div>
      </div>
    </>
  );
}
