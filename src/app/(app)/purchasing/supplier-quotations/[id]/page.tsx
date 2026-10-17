import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, LinkButton, StatusBadge, Card, KeyValues } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { AttachmentsPanel, HistoryPanel } from "@/components/panels";
import { ActionButton } from "@/components/forms/action-button";
import { selectQuoteAction } from "@/app/actions/purchasing";
import { fmtDate, fmtMoney, fmtQty, fmtAmount, humanize } from "@/lib/format";

export default async function SqPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("purchase.view");
  const { id } = await params;
  const q = await prisma.supplierQuotation.findUnique({ where: { id }, include: { supplier: true, rfq: true, lines: { orderBy: { lineNo: "asc" } }, scores: { include: { criterion: true } }, purchaseOrders: true } });
  if (!q) notFound();
  const P = (p: string) => user.permissions.has(p);
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{q.number} <StatusBadge status={q.status} /></span>} subtitle={q.supplier.legalName}
        crumbs={[{ label: "Procurement" }, { label: "Supplier quotations", href: "/purchasing/rfqs?tab=offers" }, { label: q.number }]}
        actions={<>
          {q.status === "RECEIVED" && !q.rfqId && P("purchase.rfq.manage") && <ActionButton variant="primary" label="Select offer" prompt="Justification" action={selectQuoteAction.bind(null, id)} />}
          {q.status === "SELECTED" && P("purchase.order.manage") && <LinkButton variant="action" href={`/purchasing/orders/new?supplierQuotationId=${id}`}>Create purchase order</LinkButton>}
        </>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <KeyValues items={[["Supplier", <Link key="s" className="link" href={`/suppliers/${q.supplierId}`}>{q.supplier.legalName}</Link>], ["Supplier ref.", q.supplierRef], ["RFQ", q.rfq ? <Link key="r" className="link" href={`/purchasing/rfqs/${q.rfq.id}`}>{q.rfq.number}</Link> : "—"],
              ["Date", fmtDate(q.date)], ["Valid until", fmtDate(q.validUntil)], ["Delivery", q.deliveryDays != null ? `${q.deliveryDays} days` : "—"], ["Payment terms", q.paymentTerms], ["Delivery terms", q.deliveryTerms],
              ["Compliance", <StatusBadge key="c" status={q.technicalCompliance} />], ["Total", <b key="t">{fmtMoney(q.total, q.currency)}</b>], ["POs", q.purchaseOrders.map((p) => p.number).join(", ") || "—"]]} />
            {q.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{q.notes}</p>}
          </Card>
          <DataTable basePath={`/purchasing/supplier-quotations/${id}`} columns={[{ label: "#" }, { label: "Description" }, { label: "Qty", align: "right" }, { label: "Unit price", align: "right" }, { label: "Disc %", align: "right" }, { label: "Net", align: "right" }]}
            rows={q.lines.map((l) => ({ key: l.id, cells: [l.lineNo, l.description, `${fmtQty(l.quantity)} ${l.uom ?? ""}`, fmtAmount(l.unitPrice), fmtQty(l.discountPct), fmtAmount(l.lineTotal)] }))} />
          {q.scores.length > 0 && <Card title="Evaluation scores"><KeyValues cols={4} items={q.scores.map((s) => [s.criterion.name, `${s.score} / 10`])} /></Card>}
        </div>
        <div className="space-y-4">
          <AttachmentsPanel user={user} docType="SUPPLIER_QUOTATION" docId={id} title="Supplier offer documents" />
          <HistoryPanel entity="SupplierQuotation" entityId={id} docType="SUPPLIER_QUOTATION" />
        </div>
      </div>
    </>
  );
}
