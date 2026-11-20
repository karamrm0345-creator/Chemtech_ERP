import Link from "next/link";
import { notFound } from "next/navigation";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { listCustomerPayments, listSupplierPayments, openPurchaseInvoices, openSalesInvoices } from "@/server/services/payments";
import { PageHeader, Card, KeyValues, LinkButton, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { QuickFormButton } from "@/components/forms/small-forms";
import { JournalPanel, bankAccountOptions } from "@/components/journal-panel";
import { HistoryPanel } from "@/components/panels";
import { PrintButton } from "@/components/print-button";
import { allocateCustomerCreditAction, allocateSupplierCreditAction } from "@/app/actions/finance";
import { dateRange, listArgs, str, type SP } from "@/lib/params";
import { fmtAmount, fmtDate, fmtMoney, humanize, toDateInput } from "@/lib/format";
import { D } from "@/lib/decimal";
import { PaymentEntryForm } from "./payment-entry-form";

type Side = "customer" | "supplier";
const T = {
  customer: { title: "Customer receipts", one: "Receipt", base: "/finance/receipts", party: "Customer", invBase: "/finance/sales-invoices", partyBase: "/customers", manage: "finance.sales.manage" as const },
  supplier: { title: "Supplier payments", one: "Payment", base: "/finance/payments", party: "Supplier", invBase: "/finance/purchase-invoices", partyBase: "/suppliers", manage: "finance.purchase.manage" as const },
};

export async function PaymentList({ side, user, sp }: { side: Side; user: SessionUser; sp: SP }) {
  const t = T[side];
  const args = { ...listArgs(sp), ...dateRange(sp), unallocated: str(sp, "open") === "1" };
  const data = side === "customer" ? await listCustomerPayments(user, args) : await listSupplierPayments(user, args);
  return (
    <>
      <PageHeader title={t.title} subtitle={side === "customer" ? "Money received from customers. One receipt can settle several invoices; any balance is held on account." : "Money paid to suppliers, with withholding tax where it applies. One payment can settle several invoices."}
        crumbs={[{ label: "Finance" }, { label: t.title }]} actions={user.permissions.has(t.manage) && <LinkButton variant="action" href={`${t.base}/new`}>{side === "customer" ? "New receipt" : "New payment"}</LinkButton>} />
      <ListToolbar placeholder={`Search number, reference, ${t.party.toLowerCase()}…`} dateRange filters={[{ name: "open", label: "Allocation", options: [{ value: "1", label: "With unallocated balance" }] }]} />
      <DataTable basePath={t.base} sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty={`No ${t.title.toLowerCase()}`}
        columns={[{ label: t.one, sort: "number" }, { label: "Date", sort: "date" }, { label: t.party }, { label: "Method" }, { label: "Account" }, { label: "Reference" }, { label: "Amount", sort: "amount", align: "right" }, { label: "Unallocated", align: "right" }]}
        rows={data.rows.map((p) => {
          const open = D(p.amount).sub(D(p.allocatedAmount));
          const party = "customer" in p ? (p as { customer: { legalName: string } }).customer.legalName : (p as unknown as { supplier: { legalName: string } }).supplier.legalName;
          return { key: p.id, cells: [<Link key="n" className="link" href={`${t.base}/${p.id}`}>{p.number}</Link>, fmtDate(p.date), party, humanize(p.method), p.account ? `${p.account.code} ${p.account.name}` : "—", p.reference, fmtMoney(p.amount, p.currency), <span key="o" className={open.gt(0) ? "font-semibold text-amber-700" : ""}>{open.gt(0) ? fmtAmount(open) : "—"}</span>] };
        })} />
    </>
  );
}

export async function PaymentNew({ side, user, sp }: { side: Side; user: SessionUser; sp: SP }) {
  const t = T[side];
  const [s, currencies, banks] = await Promise.all([
    prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.currency.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    bankAccountOptions(),
  ]);
  const partyId = str(sp, side === "customer" ? "customerId" : "supplierId");
  let preset: { partyId: string; partyLabel: string; currency: string; whtRate?: string } | undefined;
  if (partyId) {
    if (side === "customer") { const c = await prisma.customer.findUnique({ where: { id: partyId } }); if (c) preset = { partyId: c.id, partyLabel: c.legalName, currency: c.currency }; }
    else { const x = await prisma.supplier.findUnique({ where: { id: partyId } }); if (x) preset = { partyId: x.id, partyLabel: x.legalName, currency: x.currency, whtRate: x.withholdingRate.toString() }; }
  }
  void user;
  return (
    <>
      <PageHeader title={side === "customer" ? "New customer receipt" : "New supplier payment"} crumbs={[{ label: "Finance" }, { label: t.title, href: t.base }, { label: "New" }]} />
      {!banks.options.length ? <Notice tone="warning">No bank or cash accounts are set up. Mark an account as Bank / cash under Accounting → Chart of accounts.</Notice>
        : <PaymentEntryForm side={side} baseCurrency={s.baseCurrency} currencies={currencies.map((c) => ({ code: c.code, rate: c.rateToBase.toString() }))} banks={banks} today={toDateInput(new Date())} preset={preset} />}
    </>
  );
}

export async function PaymentDetail({ side, user, id }: { side: Side; user: SessionUser; id: string }) {
  const t = T[side];
  const p = side === "customer"
    ? await prisma.customerPayment.findUnique({ where: { id }, include: { customer: true, account: true, allocations: { include: { invoice: true }, orderBy: { date: "asc" } } } })
    : await prisma.supplierPayment.findUnique({ where: { id }, include: { supplier: true, account: true, allocations: { include: { invoice: true }, orderBy: { date: "asc" } } } });
  if (!p) notFound();
  const party = "customer" in p ? p.customer : (p as unknown as { supplier: { id: string; legalName: string } }).supplier;
  const open = D(p.amount).sub(D(p.allocatedAmount));
  const wht = "whtAmount" in p ? D((p as { whtAmount: unknown }).whtAmount as string) : D(0);
  const openInvoices = open.gt(0) ? (side === "customer" ? await openSalesInvoices(party.id, p.currency) : await openPurchaseInvoices(party.id, p.currency)) : [];
  const allocate = side === "customer" ? allocateCustomerCreditAction.bind(null, { paymentId: id }) : allocateSupplierCreditAction.bind(null, { paymentId: id });
  return (
    <>
      <PageHeader title={p.number} subtitle={party.legalName} crumbs={[{ label: "Finance" }, { label: t.title, href: t.base }, { label: p.number }]}
        actions={<>
          {open.gt(0) && openInvoices.length > 0 && user.permissions.has(t.manage) && <QuickFormButton variant="action" label="Allocate to invoice" title={`Allocate ${fmtMoney(open, p.currency)} on account`} action={allocate}
            initial={{ invoiceId: openInvoices[0].id, amount: (open.lt(openInvoices[0].balance) ? open : openInvoices[0].balance).toFixed(2) }}
            fields={[{ name: "invoiceId", label: "Invoice", type: "select", required: true, options: openInvoices.map((i) => ({ value: i.id, label: `${i.number} · due ${fmtDate(i.dueDate)} · open ${fmtAmount(i.balance)}` })) }, { name: "amount", label: `Amount (${p.currency})`, required: true }, { name: "date", label: "Date", type: "date" }]} />}
          <PrintButton />
        </>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card><KeyValues items={[
            [t.party, <Link key="p" className="link" href={`${t.partyBase}/${party.id}`}>{party.legalName}</Link>], ["Date", fmtDate(p.date)], ["Method", humanize(p.method)],
            ["Amount", <b key="a">{fmtMoney(p.amount, p.currency)}</b>], ["Exchange rate", p.currency === "QAR" ? "—" : D(p.exchangeRate).toString()], ["Account", p.account ? `${p.account.code} ${p.account.name}` : "—"],
            ...(side === "supplier" ? [["Withholding tax", wht.gt(0) ? `${fmtMoney(wht, p.currency)} (${D((p as unknown as { whtRate: string }).whtRate).toFixed(2)}%)` : "—"] as [string, string], ["Bank paid", fmtMoney(D(p.amount).sub(wht), p.currency)] as [string, string]] : []),
            ["Reference", p.reference ?? "—"], ["Allocated", fmtMoney(p.allocatedAmount, p.currency)], ["On account", <span key="o" className={open.gt(0) ? "font-semibold text-amber-700" : ""}>{fmtMoney(open, p.currency)}</span>],
          ]} /></Card>
          <Card title="Allocations" bodyClass="p-0">
            <DataTable basePath={`${t.base}/${id}`} empty="Not allocated to any invoice" columns={[{ label: "Invoice" }, { label: "Invoice date" }, { label: "Allocated on" }, { label: "Amount", align: "right" }]}
              rows={p.allocations.map((a) => ({ key: a.id, cells: [<Link key="i" className="link" href={`${t.invBase}/${a.invoiceId}`}>{a.invoice.number}</Link>, fmtDate(a.invoice.date), fmtDate(a.date), fmtMoney(a.amount, p.currency)] }))} />
          </Card>
          {open.gt(0) && openInvoices.length === 0 && <Notice>{fmtMoney(open, p.currency)} is held on account. Allocate it when the next invoice is posted.</Notice>}
        </div>
        <div className="no-print space-y-4">
          <JournalPanel user={user} sourceType={side === "customer" ? "CustomerPayment" : "SupplierPayment"} sourceId={id} />
          <HistoryPanel entity={side === "customer" ? "CustomerPayment" : "SupplierPayment"} entityId={id} />
        </div>
      </div>
    </>
  );
}
