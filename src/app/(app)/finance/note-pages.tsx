import Link from "next/link";
import { notFound } from "next/navigation";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { listCreditNotes, listDebitNotes } from "@/server/services/returns";
import { openPurchaseInvoices, openSalesInvoices } from "@/server/services/payments";
import { PageHeader, StatusBadge, Card, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { CommercialDocument } from "@/components/document";
import { ActionButton } from "@/components/forms/action-button";
import { QuickFormButton } from "@/components/forms/small-forms";
import { JournalPanel } from "@/components/journal-panel";
import { HistoryPanel } from "@/components/panels";
import { PrintButton } from "@/components/print-button";
import {
  postCreditNoteAction, cancelCreditNoteAction, postDebitNoteAction, cancelDebitNoteAction, allocateCustomerCreditAction, allocateSupplierCreditAction, refundAction,
} from "@/app/actions/finance";
import { refundsFor } from "@/server/services/payments";
import { bankAccountOptions } from "@/components/journal-panel";
import { listArgs, str, type SP } from "@/lib/params";
import { fmtAmount, fmtDate, fmtMoney } from "@/lib/format";
import { D } from "@/lib/decimal";

type Kind = "credit" | "debit";
const T = {
  credit: { title: "Credit notes", one: "Credit note", base: "/finance/credit-notes", party: "Customer", partyBase: "/customers", invBase: "/finance/sales-invoices", manage: "finance.sales.manage" as const },
  debit: { title: "Debit notes", one: "Debit note", base: "/finance/debit-notes", party: "Supplier", partyBase: "/suppliers", invBase: "/finance/purchase-invoices", manage: "finance.purchase.manage" as const },
};

export async function NoteList({ kind, user, sp }: { kind: Kind; user: SessionUser; sp: SP }) {
  const t = T[kind];
  const args = { ...listArgs(sp), status: str(sp, "status") };
  const data = kind === "credit" ? await listCreditNotes(user, args) : await listDebitNotes(user, args);
  return (
    <>
      <PageHeader title={t.title} subtitle={kind === "credit" ? "Credits to customers against posted sales invoices (returns, price allowances). Raise one from the invoice." : "Claims on suppliers against posted supplier invoices (returned goods, price allowances). Raise one from the supplier invoice."}
        crumbs={[{ label: "Finance" }, { label: t.title }]} />
      <ListToolbar placeholder={`Search number, reason, ${t.party.toLowerCase()}…`} filters={[{ name: "status", label: "Status", options: [{ value: "DRAFT", label: "Draft" }, { value: "POSTED", label: "Posted" }, { value: "CANCELLED", label: "Cancelled" }] }]} />
      <DataTable basePath={t.base} sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty={`No ${t.title.toLowerCase()}`}
        columns={[{ label: t.one, sort: "number" }, { label: "Date", sort: "date" }, { label: t.party }, { label: "Invoice" }, { label: "Reason" }, { label: "Total", sort: "total", align: "right" }, { label: "Unapplied", align: "right" }, { label: "Status", sort: "status" }]}
        rows={data.rows.map((nt) => {
          const party = "customer" in nt ? (nt as { customer: { legalName: string } }).customer.legalName : (nt as unknown as { supplier: { legalName: string } }).supplier.legalName;
          const open = nt.status === "POSTED" ? D(nt.total).sub(D(nt.allocatedAmount)) : D(0);
          return { key: nt.id, cells: [<Link key="n" className="link" href={`${t.base}/${nt.id}`}>{nt.number}</Link>, fmtDate(nt.date), party, nt.invoice.number, <span key="r" className="line-clamp-1">{nt.reason}</span>, fmtMoney(nt.total, nt.currency), open.gt(0) ? fmtAmount(open) : "—", <StatusBadge key="s" status={nt.status} />] };
        })} />
    </>
  );
}

export async function NoteDetail({ kind, user, id }: { kind: Kind; user: SessionUser; id: string }) {
  const t = T[kind];
  const nt = kind === "credit"
    ? await prisma.creditNote.findUnique({ where: { id }, include: { customer: true, invoice: true, lines: true, customerReturn: true, allocations: { include: { invoice: true } } } })
    : await prisma.debitNote.findUnique({ where: { id }, include: { supplier: true, invoice: true, lines: true, purchaseReturn: true, allocations: { include: { invoice: true } } } });
  if (!nt) notFound();
  const party = "customer" in nt ? nt.customer : (nt as unknown as { supplier: { id: string; legalName: string; address: string | null; country: string; taxRegNo: string | null } }).supplier;
  const manage = user.permissions.has(t.manage);
  const open = nt.status === "POSTED" ? D(nt.total).sub(D(nt.allocatedAmount)) : D(0);
  const openInvoices = open.gt(0) ? (kind === "credit" ? await openSalesInvoices(party.id, nt.currency) : await openPurchaseInvoices(party.id, nt.currency)) : [];
  const allocate = kind === "credit" ? allocateCustomerCreditAction.bind(null, { creditNoteId: id }) : allocateSupplierCreditAction.bind(null, { debitNoteId: id });
  const [refunds, banks] = await Promise.all([refundsFor(kind === "credit" ? { creditNoteId: id } : { debitNoteId: id }), bankAccountOptions()]);
  const link = "customerReturn" in nt ? nt.customerReturn && { label: "Customer return", no: nt.customerReturn.number, href: `/sales/returns/${nt.customerReturn.id}` }
    : (nt as unknown as { purchaseReturn: { id: string; number: string } | null }).purchaseReturn && { label: "Purchase return", no: (nt as unknown as { purchaseReturn: { number: string } }).purchaseReturn.number, href: `/purchasing/returns/${(nt as unknown as { purchaseReturn: { id: string } }).purchaseReturn.id}` };
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{nt.number} <StatusBadge status={nt.status} /></span>} subtitle={`${party.legalName} · ${nt.reason}`}
        crumbs={[{ label: "Finance" }, { label: t.title, href: t.base }, { label: nt.number }]}
        actions={<>
          {nt.status === "DRAFT" && manage && <ActionButton variant="action" label={`Post ${t.one.toLowerCase()}`} confirm={kind === "credit" ? "Posting reduces revenue, tax and the customer's balance, and applies the credit to the invoice. Continue?" : "Posting reduces the amount owed to the supplier and applies it to the invoice. Continue?"} action={(kind === "credit" ? postCreditNoteAction : postDebitNoteAction).bind(null, id)} />}
          {nt.status === "DRAFT" && manage && <ActionButton variant="danger" label="Cancel" confirm={`Cancel this draft ${t.one.toLowerCase()}?`} action={(kind === "credit" ? cancelCreditNoteAction : cancelDebitNoteAction).bind(null, id)} />}
          {open.gt(0) && openInvoices.length > 0 && manage && <QuickFormButton variant="action" label="Apply to invoice" title={`Apply ${fmtMoney(open, nt.currency)} unapplied credit`} action={allocate}
            initial={{ invoiceId: openInvoices[0].id, amount: (open.lt(openInvoices[0].balance) ? open : openInvoices[0].balance).toFixed(2) }}
            fields={[{ name: "invoiceId", label: "Invoice", type: "select", required: true, options: openInvoices.map((i) => ({ value: i.id, label: `${i.number} · open ${fmtAmount(i.balance)}` })) }, { name: "amount", label: `Amount (${nt.currency})`, required: true }]} />}
          {open.gt(0) && manage && <QuickFormButton icon="none" label={kind === "credit" ? "Refund to customer" : "Record supplier refund"} title={`Refund of ${nt.number}`}
            action={refundAction.bind(null, kind === "credit" ? { side: "CUSTOMER", creditNoteId: id } : { side: "SUPPLIER", debitNoteId: id })} initial={{ amount: open.toFixed(2), accountId: banks.defaultId, method: "BANK_TRANSFER" }}
            fields={[{ name: "amount", label: `Amount (${nt.currency})`, required: true }, { name: "date", label: "Date", type: "date" }, { name: "accountId", label: kind === "credit" ? "Paid from" : "Received into", type: "select", required: true, options: banks.options }, { name: "reference", label: "Reference" }, { name: "reason", label: "Reason", required: true }]} />}
          <PrintButton />
        </>} />
      {open.gt(0) && openInvoices.length === 0 && <div className="mb-4"><Notice>{fmtMoney(open, nt.currency)} of this note is unapplied and stays on the {t.party.toLowerCase()}&apos;s account until it is applied to another invoice.</Notice></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <CommercialDocument title={nt.status === "DRAFT" ? `Draft ${t.one.toLowerCase()}` : t.one} number={nt.number} partyLabel={kind === "credit" ? "Credit to" : "Debit to"}
            party={{ name: party.legalName, lines: [party.address, party.country, party.taxRegNo && `Tax reg. ${party.taxRegNo}`] }}
            meta={[["Date", fmtDate(nt.date)], ["Against invoice", kind === "credit" ? nt.invoice.number : `${nt.invoice.number} (${(nt.invoice as unknown as { supplierInvoiceNo: string }).supplierInvoiceNo})`], ...(link ? [[link.label, link.no] as [string, string]] : []), ...(kind === "debit" && (nt as unknown as { supplierRef: string | null }).supplierRef ? [["Supplier ref.", (nt as unknown as { supplierRef: string }).supplierRef] as [string, string]] : []), ["Currency", nt.currency]]}
            lines={nt.lines.map((l, i) => ({ no: i + 1, description: l.description, qty: l.quantity, unitPrice: l.unitPrice, discountPct: "discountPct" in l ? (l as unknown as { discountPct: string }).discountPct : 0, taxRate: l.taxRate, total: l.lineTotal }))}
            currency={nt.currency} totals={[["Subtotal", nt.subtotal], ["Tax", nt.taxTotal], ["Total", nt.total]]} notes={nt.reason} signatures={["Prepared by", "Authorised signatory"]} />
          {nt.status === "POSTED" && <Card title="Applied to invoices" bodyClass="p-0 no-print">
            <DataTable basePath={`${t.base}/${id}`} empty="Not applied" columns={[{ label: "Invoice" }, { label: "Applied on" }, { label: "Amount", align: "right" }]}
              rows={nt.allocations.map((a) => ({ key: a.id, cells: [<Link key="i" className="link" href={`${t.invBase}/${a.invoiceId}`}>{a.invoice.number}</Link>, fmtDate(a.date), fmtMoney(a.amount, nt.currency)] }))} />
          </Card>}
          {refunds.length > 0 && <Card title="Refunds" bodyClass="p-0 no-print"><DataTable basePath={`${t.base}/${id}`} columns={[{ label: "Refund" }, { label: "Date" }, { label: "Reason" }, { label: "Amount", align: "right" }]}
            rows={refunds.map((r) => ({ key: r.id, cells: [r.number, fmtDate(r.date), r.reason, fmtMoney(r.amount, r.currency)] }))} /></Card>}
          <Notice><Link className="link" href={`${t.invBase}/${nt.invoiceId}`}>Open invoice {nt.invoice.number}</Link>{link && <> · <Link className="link" href={link.href}>{link.label} {link.no}</Link></>}</Notice>
        </div>
        <div className="no-print space-y-4">
          <JournalPanel user={user} sourceType={kind === "credit" ? "CreditNote" : "DebitNote"} sourceId={id} />
          <HistoryPanel entity={kind === "credit" ? "CreditNote" : "DebitNote"} entityId={id} />
        </div>
      </div>
    </>
  );
}
