import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Card, KeyValues, LinkButton } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { JournalPanel } from "@/components/journal-panel";
import { HistoryPanel } from "@/components/panels";
import { PrintButton } from "@/components/print-button";
import { fmtDate, fmtQty } from "@/lib/format";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("sales.view");
  const { id } = await params;
  const r = await prisma.customerReturn.findUnique({ where: { id }, include: { customer: true, delivery: true, lines: true, creditNotes: true } });
  if (!r) notFound();
  const invoices = await prisma.salesInvoice.findMany({ where: { salesOrderId: r.salesOrderId, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] } }, orderBy: { date: "asc" } });
  const so = await prisma.salesOrder.findUnique({ where: { id: r.salesOrderId }, select: { number: true } });
  const canCredit = user.permissions.has("finance.sales.manage") && r.lines.some((l) => Number(l.creditedQty) < Number(l.quantity));
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{r.number} <StatusBadge status={r.status} /></span>} subtitle={`${r.customer.legalName} · ${r.reason}`}
        crumbs={[{ label: "Sales" }, { label: "Customer returns", href: "/sales/returns" }, { label: r.number }]}
        actions={<>{canCredit && invoices.map((i) => <LinkButton key={i.id} variant="action" href={`/finance/credit-notes/new?invoiceId=${i.id}&returnId=${r.id}`}>Credit note on {i.number}</LinkButton>)}<PrintButton /></>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card><KeyValues items={[["Customer", <Link key="c" className="link" href={`/customers/${r.customerId}`}>{r.customer.legalName}</Link>], ["Date", fmtDate(r.date)],
            ["Delivery", <Link key="d" className="link" href={`/sales/deliveries/${r.deliveryId}`}>{r.delivery.number}</Link>], ["Sales order", so ? <Link key="s" className="link" href={`/sales/orders/${r.salesOrderId}`}>{so.number}</Link> : "—"],
            ["Credit notes", r.creditNotes.length ? r.creditNotes.map((c) => c.number).join(", ") : "None yet"]]} /></Card>
          <DataTable basePath={`/sales/returns/${id}`} columns={[{ label: "Description" }, { label: "Returned", align: "right" }, { label: "Credited", align: "right" }, { label: "Batch" }, { label: "Serials" }]}
            rows={r.lines.map((l) => ({ key: l.id, cells: [l.description, fmtQty(l.quantity), fmtQty(l.creditedQty), l.batchNo ?? "—", l.serialNos ?? "—"] }))} />
        </div>
        <div className="no-print space-y-4">
          <JournalPanel user={user} sourceType="CustomerReturn" sourceId={id} />
          <HistoryPanel entity="CustomerReturn" entityId={id} />
        </div>
      </div>
    </>
  );
}
