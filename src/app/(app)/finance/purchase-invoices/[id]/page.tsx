import Link from "next/link";
import { bankAccountOptions } from "@/components/journal-panel";
import { JournalPanel } from "@/components/journal-panel";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Card, KeyValues, Notice, LinkButton } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { AttachmentsPanel, HistoryPanel } from "@/components/panels";
import { ActionButton } from "@/components/forms/action-button";
import { QuickFormButton } from "@/components/forms/small-forms";
import { postPurchaseInvoiceAction, supplierPaymentForInvoiceAction } from "@/app/actions/finance";
import { fmtDate, fmtMoney, fmtQty, fmtAmount, humanize } from "@/lib/format";
import { D } from "@/lib/decimal";

export default async function PiPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("finance.view");
  const { id } = await params;
  const inv = await prisma.purchaseInvoice.findUnique({ where: { id }, include: { supplier: true, purchaseOrder: true, lines: true, costCenter: true, allocations: { orderBy: { date: "asc" }, include: { payment: true, debitNote: true } } } });
  if (!inv) notFound();
  const manage = user.permissions.has("finance.purchase.manage");
  const balance = D(inv.total).sub(D(inv.paidAmount));
  const banks = await bankAccountOptions();
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{inv.number} <StatusBadge status={inv.status} /> <StatusBadge status={inv.matchStatus} /></span>} subtitle={`${inv.supplier.legalName} · invoice ${inv.supplierInvoiceNo}`}
        crumbs={[{ label: "Finance" }, { label: "Supplier invoices", href: "/finance/purchase-invoices" }, { label: inv.number }]}
        actions={<>
          {inv.status === "DRAFT" && manage && inv.matchStatus !== "VARIANCE" && <ActionButton variant="action" label="Post invoice" confirm="Post this supplier invoice as a payable?" action={postPurchaseInvoiceAction.bind(null, id)} />}
          {inv.status === "DRAFT" && manage && inv.matchStatus === "VARIANCE" && <ActionButton variant="danger" label="Accept variance & post" prompt="Justification for accepting the variance" promptRequired action={postPurchaseInvoiceAction.bind(null, id)} />}
          {["POSTED", "PARTIALLY_PAID", "PAID"].includes(inv.status) && manage && inv.lines.some((l) => Number(l.debitedQty) < Number(l.quantity)) && <LinkButton variant="outline" href={`/finance/debit-notes/new?invoiceId=${id}`}>Debit note</LinkButton>}
          {["POSTED", "PARTIALLY_PAID"].includes(inv.status) && manage && <QuickFormButton variant="action" label="Record payment" title="Record supplier payment" action={supplierPaymentForInvoiceAction.bind(null, id)}
            initial={{ amount: balance.toFixed(2), method: "BANK_TRANSFER", accountId: banks.defaultId, whtRate: inv.supplier.withholdingRate.toString() }} fields={[
              { name: "amount", label: `Amount (${inv.currency}), balance ${balance.toFixed(2)}`, required: true }, { name: "date", label: "Date", type: "date" },
              { name: "method", label: "Method", type: "select", required: true, options: ["BANK_TRANSFER", "CHEQUE", "CASH", "OTHER"].map((m) => ({ value: m, label: humanize(m) })) },
              { name: "accountId", label: "Paid through (bank / cash account)", type: "select", required: true, options: banks.options },
              { name: "whtRate", label: "Withholding tax % (deducted from the bank payment)" },
              { name: "reference", label: "Reference" },
            ]} />}
        </>} />
      {inv.matchStatus === "VARIANCE" && <div className="mb-4"><Notice tone="warning"><b>3-way match variance:</b> {inv.matchNotes}</Notice></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card><KeyValues items={[["Supplier", <Link key="s" className="link" href={`/suppliers/${inv.supplierId}`}>{inv.supplier.legalName}</Link>], ["Supplier invoice no.", inv.supplierInvoiceNo], ["Purchase order", inv.purchaseOrder ? <Link key="p" className="link" href={`/purchasing/orders/${inv.purchaseOrder.id}`}>{inv.purchaseOrder.number}</Link> : "—"], ["Date", fmtDate(inv.date)], ["Due", fmtDate(inv.dueDate)], ["Freight / charges", fmtMoney(inv.charges, inv.currency)], ["Total", <b key="t">{fmtMoney(inv.total, inv.currency)}</b>], ["Settled", fmtMoney(inv.paidAmount, inv.currency)], ...(D(inv.debitedAmount).gt(0) ? [["of which debit notes", fmtMoney(inv.debitedAmount, inv.currency)] as [string, string]] : []), ...(inv.costCenter ? [["Cost centre", `${inv.costCenter.code} ${inv.costCenter.name}`] as [string, string]] : []), ["Balance", fmtMoney(balance, inv.currency)]]} /></Card>
          <DataTable basePath={`/finance/purchase-invoices/${id}`} columns={[{ label: "Description" }, { label: "Qty", align: "right" }, { label: "Unit price", align: "right" }, { label: "Tax %", align: "right" }, { label: "Net", align: "right" }]}
            rows={inv.lines.map((l) => ({ key: l.id, cells: [l.description, fmtQty(l.quantity), fmtAmount(l.unitPrice), fmtQty(l.taxRate), fmtAmount(l.lineTotal)] }))} />
          {inv.status !== "DRAFT" && <Card title="Payments & debit notes" bodyClass="p-0"><DataTable basePath={`/finance/purchase-invoices/${id}`} empty="Nothing paid yet" columns={[{ label: "Settled by" }, { label: "Type" }, { label: "Date" }, { label: "Method / reason" }, { label: "Amount", align: "right" }]}
            rows={inv.allocations.map((a) => ({ key: a.id, cells: [
              a.payment ? <Link key="p" className="link" href={`/finance/payments/${a.payment.id}`}>{a.payment.number}</Link> : <Link key="d" className="link" href={`/finance/debit-notes/${a.debitNote!.id}`}>{a.debitNote!.number}</Link>,
              a.payment ? "Payment" : "Debit note", fmtDate(a.date), a.payment ? `${humanize(a.payment.method)}${D(a.payment.whtAmount).gt(0) ? ` · WHT ${fmtAmount(a.payment.whtAmount)}` : ""}` : a.debitNote!.reason, fmtMoney(a.amount, inv.currency)] }))} /></Card>}
        </div>
        <div className="space-y-4">
          <AttachmentsPanel user={user} docType="PURCHASE_INVOICE" docId={id} title="Invoice copy" />
          <JournalPanel user={user} sourceType="PurchaseInvoice" sourceId={id} />
          <HistoryPanel entity="PurchaseInvoice" entityId={id} />
        </div>
      </div>
    </>
  );
}
