import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { invoiceableLines } from "@/server/services/finance";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { toDateInput } from "@/lib/format";
import { InvoiceForm } from "./form";

export const metadata = { title: "New sales invoice" };

export default async function Page({ searchParams }: { searchParams: Promise<{ salesOrderId?: string }> }) {
  await requireUser("finance.sales.manage");
  const { salesOrderId } = await searchParams;
  if (!salesOrderId) return <Notice>Open a sales order and choose “Invoice”.</Notice>;
  const so = await prisma.salesOrder.findUnique({ where: { id: salesOrderId }, include: { customer: true } });
  if (!so) notFound();
  const lines = (await invoiceableLines(salesOrderId)).filter((l) => l.invoiceable.gt(0)).map((l) => ({
    id: l.line.id, lineNo: l.line.lineNo, description: l.line.description, invoiceable: l.invoiceable.toNumber(), unitPrice: l.line.unitPrice.toString(), discountPct: l.line.discountPct.toString(), taxRate: l.line.taxRate.toString(),
  }));
  return (
    <>
      <PageHeader title={`Invoice ${so.number}`} subtitle={so.customer.legalName} crumbs={[{ label: "Sales orders", href: "/sales/orders" }, { label: so.number, href: `/sales/orders/${so.id}` }, { label: "Invoice" }]} />
      {lines.length === 0 ? <Notice>Nothing is invoiceable yet. Stocked items must be delivered before they can be invoiced, and lines already invoiced (or on draft invoices) are excluded.</Notice>
        : <InvoiceForm salesOrderId={so.id} currency={so.currency} lines={lines} date={toDateInput(new Date())} />}
    </>
  );
}
