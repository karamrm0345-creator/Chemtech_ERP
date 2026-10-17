import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Card, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { CommercialDocument } from "@/components/document";
import { AttachmentsPanel, HistoryPanel } from "@/components/panels";
import { ActionButton } from "@/components/forms/action-button";
import { QuickFormButton } from "@/components/forms/small-forms";
import { PrintButton } from "@/components/print-button";
import { postSalesInvoiceAction, cancelSalesInvoiceAction, customerPaymentForInvoiceAction } from "@/app/actions/finance";
import { fmtDate, fmtMoney, humanize } from "@/lib/format";
import { D } from "@/lib/decimal";

export default async function SiPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("finance.view");
  const { id } = await params;
  const inv = await prisma.salesInvoice.findUnique({ where: { id }, include: { customer: true, salesOrder: true, lines: true, payments: { orderBy: { date: "desc" } } } });
  if (!inv) notFound();
  const balance = D(inv.total).sub(D(inv.paidAmount));
  const manage = user.permissions.has("finance.sales.manage");
  const overdue = ["POSTED", "PARTIALLY_PAID"].includes(inv.status) && inv.dueDate < new Date();
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{inv.number} <StatusBadge status={overdue ? "OVERDUE" : inv.status} /></span>} subtitle={inv.customer.legalName}
        crumbs={[{ label: "Finance" }, { label: "Sales invoices", href: "/finance/sales-invoices" }, { label: inv.number }]}
        actions={<>
          {inv.status === "DRAFT" && manage && <ActionButton variant="action" label="Post invoice" confirm="Posting issues the invoice and records it as revenue and a receivable. Continue?" action={postSalesInvoiceAction.bind(null, id)} />}
          {inv.status === "DRAFT" && manage && <ActionButton variant="danger" label="Cancel" confirm="Cancel this draft invoice?" action={cancelSalesInvoiceAction.bind(null, id)} />}
          {["POSTED", "PARTIALLY_PAID"].includes(inv.status) && manage && <QuickFormButton variant="action" label="Record receipt" title="Record customer payment" action={customerPaymentForInvoiceAction.bind(null, id)}
            initial={{ amount: balance.toFixed(2), method: "BANK_TRANSFER" }} fields={[
              { name: "amount", label: `Amount (${inv.currency}), balance ${balance.toFixed(2)}`, required: true }, { name: "date", label: "Date", type: "date" },
              { name: "method", label: "Method", type: "select", required: true, options: ["BANK_TRANSFER", "CHEQUE", "CASH", "CARD", "OTHER"].map((m) => ({ value: m, label: humanize(m) })) },
              { name: "reference", label: "Reference (bank ref / cheque no.)" },
            ]} />}
          <PrintButton />
        </>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <CommercialDocument title={inv.status === "DRAFT" ? "Draft invoice" : "Tax invoice"} number={inv.number} partyLabel="Bill to"
            party={{ name: inv.customer.legalName, lines: [inv.customer.address, inv.customer.country, inv.customer.taxRegNo && `Tax reg. ${inv.customer.taxRegNo}`] }}
            meta={[["Invoice date", fmtDate(inv.date)], ["Due date", fmtDate(inv.dueDate)], ["Sales order", inv.salesOrder?.number], ["Customer PO", inv.salesOrder?.customerPoRef], ["Currency", inv.currency]]}
            lines={inv.lines.map((l, i) => ({ no: i + 1, description: l.description, qty: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate, total: l.lineTotal }))}
            currency={inv.currency} totals={[["Subtotal", inv.subtotal], ["Tax", inv.taxTotal], ["Total", inv.total]]} notes={inv.notes} signatures={["Prepared by", "Authorised signatory"]} />
          {inv.status !== "DRAFT" && (
            <Card title={`Payments · balance ${fmtMoney(balance, inv.currency)}`} bodyClass="p-0 no-print">
              <DataTable basePath={`/finance/sales-invoices/${id}`} empty="No payments recorded" columns={[{ label: "Receipt" }, { label: "Date" }, { label: "Method" }, { label: "Reference" }, { label: "Amount", align: "right" }]}
                rows={inv.payments.map((p) => ({ key: p.id, cells: [p.number, fmtDate(p.date), humanize(p.method), p.reference, fmtMoney(p.amount, inv.currency)] }))} />
            </Card>
          )}
          {inv.salesOrder && <Notice>Linked sales order: <Link className="link" href={`/sales/orders/${inv.salesOrder.id}`}>{inv.salesOrder.number}</Link></Notice>}
        </div>
        <div className="no-print space-y-4">
          <AttachmentsPanel user={user} docType="SALES_INVOICE" docId={id} />
          <HistoryPanel entity="SalesInvoice" entityId={id} />
        </div>
      </div>
    </>
  );
}
