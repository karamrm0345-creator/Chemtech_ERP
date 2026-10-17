import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, Card, KeyValues, LinkButton, StatusBadge, Tabs, Badge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { AttachmentsPanel, HistoryPanel } from "@/components/panels";
import { AddContactButton } from "@/components/forms/contact-form";
import { ActionButton } from "@/components/forms/action-button";
import { addCustomerContactAction, deleteCustomerContactAction } from "@/app/actions/masterdata";
import { fmtDate, fmtMoney, fmtAmount } from "@/lib/format";
import { CUSTOMER_CATEGORY_LABEL } from "@/lib/options";
import { D } from "@/lib/decimal";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("customer.view");
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const c = await prisma.customer.findUnique({ where: { id }, include: { contacts: { orderBy: { isPrimary: "desc" } } } });
  if (!c) notFound();
  const canSales = user.permissions.has("sales.view");
  const canFin = user.permissions.has("finance.view");
  const [quotations, orders, deliveries, invoices, rep] = await Promise.all([
    canSales ? prisma.salesQuotation.findMany({ where: { customerId: id }, orderBy: { date: "desc" }, take: 100 }) : [],
    canSales ? prisma.salesOrder.findMany({ where: { customerId: id }, orderBy: { date: "desc" }, take: 100 }) : [],
    canSales ? prisma.deliveryOrder.findMany({ where: { customerId: id }, include: { salesOrder: { select: { number: true } } }, orderBy: { date: "desc" }, take: 100 }) : [],
    canFin ? prisma.salesInvoice.findMany({ where: { customerId: id }, orderBy: { date: "desc" }, take: 100 }) : [],
    c.salesRepId ? prisma.user.findUnique({ where: { id: c.salesRepId }, select: { name: true } }) : null,
  ]);
  const confirmed = orders.filter((o) => ["APPROVED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED"].includes(o.status));
  const orderValue = confirmed.reduce((s, o) => s.add(D(o.total).mul(D(o.exchangeRate))), D(0));
  const openOrders = orders.filter((o) => ["SUBMITTED", "APPROVED", "PARTIALLY_DELIVERED"].includes(o.status)).length;
  const outstanding = invoices.filter((i) => ["POSTED", "PARTIALLY_PAID"].includes(i.status)).reduce((s, i) => s.add(D(i.total).sub(D(i.paidAmount)).mul(D(i.exchangeRate))), D(0));
  const base = `/customers/${id}`;
  const tabs = [
    { key: "overview", label: "Overview", href: base },
    { key: "contacts", label: "Contacts", href: `${base}?tab=contacts`, count: c.contacts.length },
    ...(canSales ? [
      { key: "quotations", label: "Quotations", href: `${base}?tab=quotations`, count: quotations.length },
      { key: "orders", label: "Sales orders", href: `${base}?tab=orders`, count: orders.length },
      { key: "deliveries", label: "Deliveries", href: `${base}?tab=deliveries`, count: deliveries.length },
    ] : []),
    ...(canFin ? [{ key: "invoices", label: "Invoices & payments", href: `${base}?tab=invoices`, count: invoices.length }] : []),
    { key: "documents", label: "Documents & history", href: `${base}?tab=documents` },
  ];

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{c.legalName} <StatusBadge status={c.active ? "ACTIVE" : "INACTIVE"} /></span>}
        subtitle={<>{c.code} · {CUSTOMER_CATEGORY_LABEL[c.category]}{c.tradingName && ` · trading as ${c.tradingName}`}</>}
        crumbs={[{ label: "Customers", href: "/customers" }, { label: c.code }]}
        actions={<>
          {user.permissions.has("sales.quotation.manage") && <LinkButton variant="outline" href={`/sales/quotations/new?customerId=${c.id}`}><Plus className="h-4 w-4" /> Quotation</LinkButton>}
          {user.permissions.has("sales.order.manage") && <LinkButton variant="outline" href={`/sales/orders/new?customerId=${c.id}`}><Plus className="h-4 w-4" /> Sales order</LinkButton>}
          {user.permissions.has("customer.manage") && <LinkButton href={`${base}/edit`}><Pencil className="h-4 w-4" /> Edit</LinkButton>}
        </>}
      />
      <Tabs tabs={tabs} active={tab} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Profile" className="lg:col-span-2">
            <KeyValues items={[
              ["Country / city", [c.country, c.city].filter(Boolean).join(", ")], ["Address", c.address], ["Email", c.email], ["Telephone", c.phone],
              ["Tax reg. no.", c.taxRegNo], ["CR number", c.crNumber], ["Payment terms", `${c.paymentTerms ?? "—"} (${c.paymentTermDays} days)`],
              ["Credit limit", fmtMoney(c.creditLimit, c.currency)], ["Currency", c.currency], ["Classification", c.classification], ["Sales rep", rep?.name],
              ["Created", fmtDate(c.createdAt)],
            ]} />
            {c.notes && <p className="mt-4 whitespace-pre-wrap rounded-md bg-panel p-3 text-sm">{c.notes}</p>}
            {c.isDemo && <div className="mt-3"><Badge tone="amber">DEMO RECORD</Badge></div>}
          </Card>
          <Card title="Sales summary">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-ink-soft">Confirmed order value</dt><dd className="font-semibold">{fmtMoney(orderValue)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Open sales orders</dt><dd className="font-semibold">{openOrders}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Quotations</dt><dd className="font-semibold">{quotations.length}</dd></div>
              {canFin && <div className="flex justify-between"><dt className="text-ink-soft">Outstanding balance</dt><dd className="font-semibold">{fmtMoney(outstanding)}</dd></div>}
              {canFin && D(c.creditLimit).gt(0) && outstanding.gt(c.creditLimit) && <p className="rounded bg-red-50 p-2 text-xs font-semibold text-red-700">Outstanding balance exceeds credit limit.</p>}
            </dl>
          </Card>
        </div>
      )}

      {tab === "contacts" && (
        <Card title="Contacts" actions={user.permissions.has("customer.manage") && <AddContactButton action={addCustomerContactAction.bind(null, c.id)} />} bodyClass="p-0">
          <DataTable basePath={base} columns={[{ label: "Name" }, { label: "Title / department" }, { label: "Email" }, { label: "Phone" }, { label: "" }]}
            rows={c.contacts.map((k) => ({ key: k.id, cells: [
              <span key="n" className="font-medium">{k.name} {k.isPrimary && <Badge tone="blue">Primary</Badge>}</span>, [k.title, k.department].filter(Boolean).join(" · "), k.email, k.phone,
              user.permissions.has("customer.manage") ? <ActionButton key="d" variant="ghost" label="Remove" confirm={`Remove ${k.name}?`} action={deleteCustomerContactAction.bind(null, k.id)} /> : null,
            ] }))} empty="No contacts" />
        </Card>
      )}

      {tab === "quotations" && (
        <DataTable basePath={base} empty="No quotations" columns={[{ label: "Number" }, { label: "Date" }, { label: "Reference" }, { label: "Valid until" }, { label: "Total", align: "right" }, { label: "Status" }]}
          rows={quotations.map((q) => ({ key: q.id, cells: [<Link key="l" className="link" href={`/sales/quotations/${q.id}`}>{q.number}</Link>, fmtDate(q.date), q.reference, fmtDate(q.validUntil), fmtMoney(q.total, q.currency), <StatusBadge key="s" status={q.status} />] }))} />
      )}
      {tab === "orders" && (
        <DataTable basePath={base} empty="No sales orders" columns={[{ label: "Number" }, { label: "Date" }, { label: "Customer PO" }, { label: "Required" }, { label: "Total", align: "right" }, { label: "Status" }]}
          rows={orders.map((o) => ({ key: o.id, cells: [<Link key="l" className="link" href={`/sales/orders/${o.id}`}>{o.number}</Link>, fmtDate(o.date), o.customerPoRef, fmtDate(o.requiredDate), fmtMoney(o.total, o.currency), <StatusBadge key="s" status={o.status} />] }))} />
      )}
      {tab === "deliveries" && (
        <DataTable basePath={base} empty="No deliveries" columns={[{ label: "Number" }, { label: "Date" }, { label: "Sales order" }, { label: "Status" }]}
          rows={deliveries.map((d) => ({ key: d.id, cells: [<Link key="l" className="link" href={`/sales/deliveries/${d.id}`}>{d.number}</Link>, fmtDate(d.date), d.salesOrder.number, <StatusBadge key="s" status={d.status} />] }))} />
      )}
      {tab === "invoices" && (
        <DataTable basePath={base} empty="No invoices" columns={[{ label: "Invoice" }, { label: "Date" }, { label: "Due" }, { label: "Total", align: "right" }, { label: "Paid", align: "right" }, { label: "Balance", align: "right" }, { label: "Status" }]}
          rows={invoices.map((i) => ({ key: i.id, cells: [<Link key="l" className="link" href={`/finance/sales-invoices/${i.id}`}>{i.number}</Link>, fmtDate(i.date), fmtDate(i.dueDate), fmtMoney(i.total, i.currency), fmtAmount(i.paidAmount), fmtAmount(D(i.total).sub(D(i.paidAmount))), <StatusBadge key="s" status={i.status === "POSTED" && i.dueDate < new Date() ? "OVERDUE" : i.status} />] }))} />
      )}
      {tab === "documents" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AttachmentsPanel user={user} docType="CUSTOMER" docId={c.id} title="Documents & correspondence" />
          <HistoryPanel entity="Customer" entityId={c.id} />
        </div>
      )}
    </>
  );
}
