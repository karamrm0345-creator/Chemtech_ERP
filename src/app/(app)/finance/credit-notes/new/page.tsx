import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { creditableLines } from "@/server/services/returns";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { toDateInput } from "@/lib/format";
import { D } from "@/lib/decimal";
import { NoteForm } from "../../note-form";

export const metadata = { title: "New credit note" };

export default async function Page({ searchParams }: { searchParams: Promise<{ invoiceId?: string; returnId?: string }> }) {
  await requireUser("finance.sales.manage");
  const { invoiceId, returnId } = await searchParams;
  if (!invoiceId) return <Notice>Open a posted sales invoice and choose “Credit note”.</Notice>;
  const inv = await prisma.salesInvoice.findUnique({ where: { id: invoiceId }, include: { customer: true } });
  if (!inv) notFound();
  const open = (await creditableLines(invoiceId)).filter((l) => l.open.gt(0));
  const ret = returnId ? await prisma.customerReturn.findUnique({ where: { id: returnId }, include: { lines: true } }) : null;
  const initialQty: Record<string, string> = {};
  if (ret) for (const o of open) {
    const q = ret.lines.filter((r) => r.soLineId === o.line.salesOrderLineId).reduce((s, r) => s.add(D(r.quantity).sub(D(r.creditedQty))), D(0));
    if (q.gt(0)) initialQty[o.line.id] = (q.lt(o.open) ? q : o.open).toString();
  }
  return (
    <>
      <PageHeader title={`Credit note for ${inv.number}`} subtitle={inv.customer.legalName}
        crumbs={[{ label: "Finance" }, { label: "Sales invoices", href: "/finance/sales-invoices" }, { label: inv.number, href: `/finance/sales-invoices/${inv.id}` }, { label: "Credit note" }]} />
      {!["POSTED", "PARTIALLY_PAID", "PAID"].includes(inv.status) ? <Notice tone="warning">Credit notes can only be issued against posted invoices.</Notice>
        : open.length === 0 ? <Notice>Every line of this invoice has already been credited.</Notice>
        : <>
          {ret && <div className="mb-4"><Notice>Quantities are filled from customer return {ret.number}.</Notice></div>}
          <NoteForm kind="credit" invoiceId={inv.id} currency={inv.currency} today={toDateInput(new Date())} returnId={ret?.id} initialQty={initialQty}
            lines={open.map((o) => ({ id: o.line.id, description: o.line.description, open: o.open.toString(), unitPrice: o.line.unitPrice.toString(), discountPct: o.line.discountPct.toString(), taxRate: o.line.taxRate.toString() }))} />
        </>}
    </>
  );
}
