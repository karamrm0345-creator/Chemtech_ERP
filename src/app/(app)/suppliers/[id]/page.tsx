import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus, Lock } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { getSupplier, supplierPerformance } from "@/server/services/suppliers";
import { PageHeader, Card, KeyValues, LinkButton, StatusBadge, Tabs, Badge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { AttachmentsPanel, HistoryPanel } from "@/components/panels";
import { AddContactButton } from "@/components/forms/contact-form";
import { QuickFormButton } from "@/components/forms/small-forms";
import { ActionButton } from "@/components/forms/action-button";
import {
  addSupplierContactAction, deleteSupplierContactAction, addSupplierDocumentAction, deleteSupplierDocumentAction, addSupplierIssueAction, closeSupplierIssueAction,
} from "@/app/actions/masterdata";
import { fmtDate, fmtMoney, humanize, fmtAmount } from "@/lib/format";
import { D } from "@/lib/decimal";

const DOC_TYPES = ["ISO_9001", "ISO_14001", "ISO_45001", "API_SPEC", "CR", "TRADE_LICENSE", "HSE_CERTIFICATE", "ICV_CERTIFICATE", "INSURANCE", "OTHER"];

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("supplier.view");
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const s = await getSupplier(user, id).catch(() => null);
  if (!s) notFound();
  const canP = user.permissions.has("purchase.view");
  const canF = user.permissions.has("finance.view");
  const manage = user.permissions.has("supplier.manage");
  const [perf, quotes, pos, grns, invoices] = await Promise.all([
    supplierPerformance(id),
    canP ? prisma.supplierQuotation.findMany({ where: { supplierId: id }, include: { rfq: { select: { number: true } } }, orderBy: { date: "desc" }, take: 100 }) : [],
    canP ? prisma.purchaseOrder.findMany({ where: { supplierId: id }, orderBy: { date: "desc" }, take: 100 }) : [],
    canP ? prisma.goodsReceipt.findMany({ where: { supplierId: id }, include: { purchaseOrder: { select: { number: true } } }, orderBy: { date: "desc" }, take: 100 }) : [],
    canF ? prisma.purchaseInvoice.findMany({ where: { supplierId: id }, orderBy: { date: "desc" }, take: 100 }) : [],
  ]);
  const now = Date.now();
  const expiring = s.documents.filter((d) => d.expiryDate && d.expiryDate.getTime() < now + 60 * 86_400_000);
  const poValue = pos.filter((p) => ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"].includes(p.status)).reduce((t, p) => t.add(D(p.total).mul(D(p.exchangeRate))), D(0));
  const base = `/suppliers/${id}`;
  const tabs = [
    { key: "overview", label: "Overview", href: base },
    { key: "contacts", label: "Contacts", href: `${base}?tab=contacts`, count: s.contacts.length },
    { key: "compliance", label: "Certificates & HSE", href: `${base}?tab=compliance`, count: s.documents.length },
    ...(canP ? [
      { key: "quotations", label: "Quotations", href: `${base}?tab=quotations`, count: quotes.length },
      { key: "orders", label: "Purchase orders", href: `${base}?tab=orders`, count: pos.length },
      { key: "receipts", label: "Goods receipts", href: `${base}?tab=receipts`, count: grns.length },
    ] : []),
    ...(canF ? [{ key: "invoices", label: "Invoices & payments", href: `${base}?tab=invoices`, count: invoices.length }] : []),
    { key: "quality", label: "Quality issues", href: `${base}?tab=quality`, count: s.issues.filter((i) => i.status === "OPEN").length },
    { key: "documents", label: "Documents & history", href: `${base}?tab=documents` },
  ];
  const expiryBadge = (d: Date | null) => !d ? null : d.getTime() < now ? <StatusBadge status="EXPIRED" /> : d.getTime() < now + 60 * 86_400_000 ? <StatusBadge status="PENDING" label="Expiring soon" /> : <StatusBadge status="OK" label="Valid" />;

  return (
    <>
      <PageHeader title={<span className="flex flex-wrap items-center gap-2">{s.legalName} <StatusBadge status={s.prequalStatus} /> {!s.active && <StatusBadge status="INACTIVE" />}</span>}
        subtitle={<>{s.code} · {humanize(s.category)} · {s.country}</>} crumbs={[{ label: "Suppliers", href: "/suppliers" }, { label: s.code }]}
        actions={<>
          {user.permissions.has("purchase.order.manage") && <LinkButton variant="outline" href={`/purchasing/orders/new?supplierId=${s.id}`}><Plus className="h-4 w-4" /> Purchase order</LinkButton>}
          {manage && <LinkButton href={`${base}/edit`}><Pencil className="h-4 w-4" /> Edit</LinkButton>}
        </>} />
      <Tabs tabs={tabs} active={tab} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="Profile">
              <KeyValues items={[
                ["Address", [s.address, s.city, s.country].filter(Boolean).join(", ")], ["Email", s.email], ["Telephone", s.phone], ["Website", s.website],
                ["Payment terms", `${s.paymentTerms ?? "—"} (${s.paymentTermDays} days)`], ["Currency", s.currency], ["Tax reg. no.", s.taxRegNo], ["CR number", s.crNumber],
                ["Rating", s.rating ? `${s.rating} / 5` : "Not rated"],
              ]} />
              {s.productsServices && <div className="mt-4"><p className="label">Products & services</p><p className="whitespace-pre-wrap text-sm">{s.productsServices}</p></div>}
              {s.notes && <p className="mt-3 whitespace-pre-wrap rounded bg-panel p-3 text-sm">{s.notes}</p>}
              {s.isDemo && <div className="mt-3"><Badge tone="amber">DEMO RECORD</Badge></div>}
            </Card>
            <Card title={<span className="flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> Bank details</span>}>
              {user.permissions.has("supplier.bank.view")
                ? <KeyValues items={[["Bank", s.bankName], ["Account name", s.bankAccountName], ["Account no.", s.bankAccountNo], ["IBAN", s.iban], ["SWIFT", s.swift]]} />
                : <p className="text-sm text-ink-muted">Restricted. Your role cannot view bank information.</p>}
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Delivery performance">
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between"><dt className="text-ink-soft">Posted receipts</dt><dd className="font-semibold">{perf.receipts}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">On-time delivery</dt><dd className="font-semibold">{perf.onTimePct === null ? "No data" : `${perf.onTimePct}%`}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">Rejected quantity</dt><dd className="font-semibold">{perf.rejectionPct === null ? "No data" : `${perf.rejectionPct}%`}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">Open nonconformities</dt><dd className="font-semibold">{perf.openIssues}</dd></div>
                {canP && <div className="flex justify-between"><dt className="text-ink-soft">Approved PO value</dt><dd className="font-semibold">{fmtMoney(poValue)}</dd></div>}
              </dl>
            </Card>
            {expiring.length > 0 && (
              <Card title="Expiring documents">
                <ul className="space-y-2 text-sm">{expiring.map((d) => <li key={d.id} className="flex justify-between gap-2"><span>{humanize(d.docType)}</span><span className="flex items-center gap-2">{fmtDate(d.expiryDate)} {expiryBadge(d.expiryDate)}</span></li>)}</ul>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "contacts" && (
        <Card title="Contact persons" actions={manage && <AddContactButton action={addSupplierContactAction.bind(null, s.id)} />} bodyClass="p-0">
          <DataTable basePath={base} empty="No contacts" columns={[{ label: "Name" }, { label: "Title" }, { label: "Email" }, { label: "Phone" }, { label: "" }]}
            rows={s.contacts.map((k) => ({ key: k.id, cells: [<span key="n" className="font-medium">{k.name} {k.isPrimary && <Badge tone="blue">Primary</Badge>}</span>, [k.title, k.department].filter(Boolean).join(" · "), k.email, k.phone,
              manage ? <ActionButton key="d" variant="ghost" label="Remove" confirm={`Remove ${k.name}?`} action={deleteSupplierContactAction.bind(null, k.id)} /> : null] }))} />
        </Card>
      )}

      {tab === "compliance" && (
        <Card title="Registration, quality & HSE certificates" bodyClass="p-0"
          actions={manage && <QuickFormButton label="Add certificate" title="Add certificate / document" action={addSupplierDocumentAction.bind(null, s.id)} fields={[
            { name: "docType", label: "Type", type: "select", required: true, options: DOC_TYPES.map((d) => ({ value: d, label: humanize(d) })) },
            { name: "docNumber", label: "Certificate / document no." }, { name: "issueDate", label: "Issue date", type: "date" }, { name: "expiryDate", label: "Expiry date", type: "date" }, { name: "notes", label: "Notes", type: "textarea" },
          ]} />}>
          <DataTable basePath={base} empty="No certificates recorded" emptyHint="Upload the scanned certificate under Documents & history."
            columns={[{ label: "Type" }, { label: "Number" }, { label: "Issued" }, { label: "Expiry" }, { label: "Status" }, { label: "Notes" }, { label: "" }]}
            rows={s.documents.map((d) => ({ key: d.id, cells: [humanize(d.docType), d.docNumber, fmtDate(d.issueDate), fmtDate(d.expiryDate), expiryBadge(d.expiryDate), d.notes,
              manage ? <ActionButton key="x" variant="ghost" label="Remove" confirm="Remove this record?" action={deleteSupplierDocumentAction.bind(null, d.id)} /> : null] }))} />
        </Card>
      )}

      {tab === "quotations" && (
        <DataTable basePath={base} empty="No supplier quotations" columns={[{ label: "Number" }, { label: "Supplier ref." }, { label: "RFQ" }, { label: "Date" }, { label: "Delivery" }, { label: "Total", align: "right" }, { label: "Status" }]}
          rows={quotes.map((q) => ({ key: q.id, cells: [<Link key="l" className="link" href={`/purchasing/supplier-quotations/${q.id}`}>{q.number}</Link>, q.supplierRef, q.rfq?.number, fmtDate(q.date), q.deliveryDays != null ? `${q.deliveryDays} days` : "—", fmtMoney(q.total, q.currency), <StatusBadge key="s" status={q.status} />] }))} />
      )}
      {tab === "orders" && (
        <DataTable basePath={base} empty="No purchase orders" columns={[{ label: "PO" }, { label: "Date" }, { label: "Expected" }, { label: "Total", align: "right" }, { label: "Status" }]}
          rows={pos.map((p) => ({ key: p.id, cells: [<Link key="l" className="link" href={`/purchasing/orders/${p.id}`}>{p.number}</Link>, fmtDate(p.date), fmtDate(p.expectedDate), fmtMoney(p.total, p.currency), <StatusBadge key="s" status={p.status} />] }))} />
      )}
      {tab === "receipts" && (
        <DataTable basePath={base} empty="No goods receipts" columns={[{ label: "GRN" }, { label: "Date" }, { label: "PO" }, { label: "Delivery note" }, { label: "Status" }]}
          rows={grns.map((g) => ({ key: g.id, cells: [<Link key="l" className="link" href={`/purchasing/receipts/${g.id}`}>{g.number}</Link>, fmtDate(g.date), g.purchaseOrder.number, g.supplierDeliveryNote, <StatusBadge key="s" status={g.status} />] }))} />
      )}
      {tab === "invoices" && (
        <DataTable basePath={base} empty="No supplier invoices" columns={[{ label: "Ref" }, { label: "Supplier inv." }, { label: "Date" }, { label: "Due" }, { label: "Total", align: "right" }, { label: "Balance", align: "right" }, { label: "Match" }, { label: "Status" }]}
          rows={invoices.map((i) => ({ key: i.id, cells: [<Link key="l" className="link" href={`/finance/purchase-invoices/${i.id}`}>{i.number}</Link>, i.supplierInvoiceNo, fmtDate(i.date), fmtDate(i.dueDate), fmtMoney(i.total, i.currency), fmtAmount(D(i.total).sub(D(i.paidAmount))), <StatusBadge key="m" status={i.matchStatus} />, <StatusBadge key="s" status={i.status} />] }))} />
      )}
      {tab === "quality" && (
        <Card title="Quality issues & nonconformities" bodyClass="p-0"
          actions={manage && <QuickFormButton label="Log issue" title="Log nonconformity" action={addSupplierIssueAction.bind(null, s.id)} fields={[
            { name: "severity", label: "Severity", type: "select", required: true, options: ["MINOR", "MAJOR", "CRITICAL"].map((x) => ({ value: x, label: humanize(x) })) },
            { name: "date", label: "Date", type: "date" }, { name: "description", label: "Description", type: "textarea", required: true },
          ]} initial={{ severity: "MINOR" }} />}>
          <DataTable basePath={base} empty="No quality issues recorded" columns={[{ label: "Date" }, { label: "Severity" }, { label: "Description" }, { label: "Status" }, { label: "Resolution" }, { label: "" }]}
            rows={s.issues.map((i) => ({ key: i.id, cells: [fmtDate(i.date), <Badge key="v" tone={i.severity === "CRITICAL" ? "red" : i.severity === "MAJOR" ? "amber" : "slate"}>{i.severity}</Badge>, i.description, <StatusBadge key="s" status={i.status} />, i.resolution,
              manage && i.status === "OPEN" ? <ActionButton key="c" label="Close" prompt="Resolution" promptRequired action={closeSupplierIssueAction.bind(null, i.id)} /> : null] }))} />
        </Card>
      )}
      {tab === "documents" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AttachmentsPanel user={user} docType="SUPPLIER" docId={s.id} title="Registration, quality & HSE documents" />
          <HistoryPanel entity="Supplier" entityId={s.id} />
        </div>
      )}
    </>
  );
}
