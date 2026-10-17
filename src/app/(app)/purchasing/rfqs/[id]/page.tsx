import Link from "next/link";
import { notFound } from "next/navigation";
import { Trophy, Clock, BadgeDollarSign } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { rfqComparison } from "@/server/services/purchasing";
import { PageHeader, LinkButton, StatusBadge, Card, KeyValues, Notice, Badge } from "@/components/ui/primitives";
import { HistoryPanel, AttachmentsPanel } from "@/components/panels";
import { ActionButton } from "@/components/forms/action-button";
import { PrintButton } from "@/components/print-button";
import { rfqActionAction, selectQuoteAction } from "@/app/actions/purchasing";
import { fmtDate, fmtMoney, fmtQty, fmtAmount, humanize } from "@/lib/format";
import { cn } from "@/lib/cn";

export default async function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("purchase.view");
  const { id } = await params;
  const exists = await prisma.rfq.findUnique({ where: { id }, include: { suppliers: { include: { supplier: true } }, purchaseRequest: true } });
  if (!exists) notFound();
  const { rfq, quotes, criteria, cheapest, fastest, best } = await rfqComparison(id);
  const P = (p: string) => user.permissions.has(p);
  const manage = P("purchase.rfq.manage");
  const selected = quotes.find((q) => q.status === "SELECTED");
  const quoted = new Set(quotes.map((q) => q.supplierId));
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{rfq.number} <StatusBadge status={rfq.status} /></span>} subtitle={rfq.title}
        crumbs={[{ label: "Procurement" }, { label: "RFQs", href: "/purchasing/rfqs" }, { label: rfq.number }]}
        actions={<>
          {rfq.status === "DRAFT" && manage && <ActionButton variant="primary" label="Mark as sent to suppliers" action={rfqActionAction.bind(null, id, "send")} />}
          {rfq.status === "SENT" && manage && <ActionButton label="Close for offers" action={rfqActionAction.bind(null, id, "close")} />}
          {["DRAFT", "SENT"].includes(rfq.status) && manage && <ActionButton variant="danger" label="Cancel" confirm="Cancel this RFQ?" action={rfqActionAction.bind(null, id, "cancel")} />}
          {selected && P("purchase.order.manage") && <LinkButton variant="action" href={`/purchasing/orders/new?supplierQuotationId=${selected.id}`}>Create PO from selected offer</LinkButton>}
          <PrintButton />
        </>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <KeyValues items={[["Date", fmtDate(rfq.date)], ["Offers due", fmtDate(rfq.dueDate)], ["Purchase request", exists.purchaseRequest ? <Link className="link" href={`/purchasing/requests/${exists.purchaseRequest.id}`}>{exists.purchaseRequest.number}</Link> : "—"]]} />
            {rfq.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{rfq.notes}</p>}
          </Card>
          <Card title="Invited suppliers" bodyClass="p-0">
            <table className="table-base">
              <thead><tr><th>Supplier</th><th>Offer</th><th /></tr></thead>
              <tbody>
                {exists.suppliers.map((s) => {
                  const q = quotes.find((x) => x.supplierId === s.supplierId);
                  return (
                    <tr key={s.supplierId}>
                      <td><Link className="link" href={`/suppliers/${s.supplierId}`}>{s.supplier.legalName}</Link></td>
                      <td>{q ? <Link className="link" href={`/purchasing/supplier-quotations/${q.id}`}>{q.number} · {fmtMoney(q.total, q.currency)}</Link> : <span className="text-ink-muted">Awaiting offer</span>}</td>
                      <td className="text-right">{!quoted.has(s.supplierId) && manage && ["DRAFT", "SENT", "CLOSED"].includes(rfq.status) && <LinkButton variant="outline" className="py-1 text-xs" href={`/purchasing/supplier-quotations/new?rfqId=${id}&supplierId=${s.supplierId}`}>Record offer</LinkButton>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <Card title="Quotation comparison" bodyClass="p-0">
            {quotes.length === 0 ? <p className="p-4 text-sm text-ink-muted">No offers recorded yet.</p> : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr><th className="min-w-[200px]">Criterion</th>{quotes.map((q) => <th key={q.id} className={cn("min-w-[170px]", q.status === "SELECTED" && "bg-green-50")}>{q.supplier.legalName}<div className="font-normal normal-case"><StatusBadge status={q.status} /></div></th>)}</tr>
                  </thead>
                  <tbody>
                    <tr><td className="font-semibold">Total (QAR equivalent)</td>{quotes.map((q) => <td key={q.id} className="tabular-nums"><b>{fmtMoney(q.totalBase)}</b>{q.currency !== "QAR" && <div className="text-xs text-ink-muted">{fmtMoney(q.total, q.currency)}</div>}{q.id === cheapest && <Badge tone="green"><BadgeDollarSign className="mr-0.5 inline h-3 w-3" />Lowest compliant</Badge>}</td>)}</tr>
                    <tr><td className="font-semibold">Delivery time</td>{quotes.map((q) => <td key={q.id}>{q.deliveryDays != null ? `${q.deliveryDays} days` : "—"} {q.id === fastest && <Badge tone="blue"><Clock className="mr-0.5 inline h-3 w-3" />Fastest</Badge>}</td>)}</tr>
                    <tr><td className="font-semibold">Payment terms</td>{quotes.map((q) => <td key={q.id} className="text-xs">{q.paymentTerms ?? "—"}</td>)}</tr>
                    <tr><td className="font-semibold">Delivery terms</td>{quotes.map((q) => <td key={q.id} className="text-xs">{q.deliveryTerms ?? "—"}</td>)}</tr>
                    <tr><td className="font-semibold">Technical compliance</td>{quotes.map((q) => <td key={q.id}><StatusBadge status={q.technicalCompliance} /></td>)}</tr>
                    <tr><td className="font-semibold">Valid until</td>{quotes.map((q) => <td key={q.id}>{fmtDate(q.validUntil)}</td>)}</tr>
                    {criteria.map((c) => <tr key={c.id}><td className="text-ink-soft">{c.name} <span className="text-xs">(w {Number(c.weight)})</span></td>{quotes.map((q) => <td key={q.id}>{q.scores.find((s) => s.criterionId === c.id)?.score.toString() ?? "—"} / 10</td>)}</tr>)}
                    <tr className="bg-panel/50"><td className="font-bold">Weighted score</td>{quotes.map((q) => <td key={q.id} className="font-bold">{q.weightedScore.toFixed(2)} {q.id === best && <Badge tone="green"><Trophy className="mr-0.5 inline h-3 w-3" />Best score</Badge>}</td>)}</tr>
                    {rfq.lines.map((l) => (
                      <tr key={l.id}><td className="text-xs">Line {l.lineNo}: {l.description} ({fmtQty(l.quantity)} {l.uom})</td>
                        {quotes.map((q) => { const ql = q.lines.find((x) => x.rfqLineId === l.id); return <td key={q.id} className="text-xs tabular-nums">{ql ? `${fmtAmount(ql.unitPrice)} × ${fmtQty(ql.quantity)}` : "not quoted"}</td>; })}</tr>
                    ))}
                    {manage && !selected && (
                      <tr className="no-print"><td />{quotes.map((q) => <td key={q.id}>{q.status === "RECEIVED" && q.technicalCompliance !== "NON_COMPLIANT" && <ActionButton variant="action" label="Select" prompt="Selection justification (recommended when not the lowest price)" action={selectQuoteAction.bind(null, q.id)} />}</td>)}</tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {selected && <Notice tone="success">Selected offer: <b>{selected.supplier.legalName}</b> ({selected.number}). Other offers were marked as not selected.</Notice>}
        </div>
        <div className="no-print space-y-4">
          <AttachmentsPanel user={user} docType="RFQ" docId={id} title="RFQ documents & supplier offers" />
          <HistoryPanel entity="Rfq" entityId={id} />
        </div>
      </div>
    </>
  );
}
