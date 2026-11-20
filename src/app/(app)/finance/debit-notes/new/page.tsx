import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { debitableLines } from "@/server/services/returns";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { fmtDate, toDateInput } from "@/lib/format";
import { D } from "@/lib/decimal";
import { NoteForm } from "../../note-form";

export const metadata = { title: "New debit note" };

export default async function Page({ searchParams }: { searchParams: Promise<{ invoiceId?: string; returnId?: string }> }) {
  await requireUser("finance.purchase.manage");
  const { invoiceId, returnId } = await searchParams;
  if (!invoiceId) return <Notice>Open a posted supplier invoice and choose “Debit note”.</Notice>;
  const inv = await prisma.purchaseInvoice.findUnique({ where: { id: invoiceId }, include: { supplier: true } });
  if (!inv) notFound();
  const open = (await debitableLines(invoiceId)).filter((l) => l.open.gt(0));
  const returns = inv.purchaseOrderId ? await prisma.purchaseReturn.findMany({ where: { purchaseOrderId: inv.purchaseOrderId, status: "POSTED" }, include: { lines: true }, orderBy: { date: "desc" } }) : [];
  const rets = returns.map((r) => ({ id: r.id, label: `${r.number} · ${fmtDate(r.date)} · ${r.reason}`, lines: r.lines.map((l) => ({ id: l.id, poLineId: l.poLineId, open: D(l.quantity).sub(D(l.debitedQty)).toString() })).filter((l) => D(l.open).gt(0)) })).filter((r) => r.lines.length);
  return (
    <>
      <PageHeader title={`Debit note for ${inv.number}`} subtitle={`${inv.supplier.legalName} · invoice ${inv.supplierInvoiceNo}`}
        crumbs={[{ label: "Finance" }, { label: "Supplier invoices", href: "/finance/purchase-invoices" }, { label: inv.number, href: `/finance/purchase-invoices/${inv.id}` }, { label: "Debit note" }]} />
      {!["POSTED", "PARTIALLY_PAID", "PAID"].includes(inv.status) ? <Notice tone="warning">Debit notes can only be raised against posted supplier invoices.</Notice>
        : open.length === 0 ? <Notice>Every line of this invoice has already been debited.</Notice>
        : <NoteForm kind="debit" invoiceId={inv.id} currency={inv.currency} today={toDateInput(new Date())} returns={rets} returnId={returnId && rets.some((r) => r.id === returnId) ? returnId : undefined}
            lines={open.map((o) => ({ id: o.line.id, description: o.line.description, open: o.open.toString(), unitPrice: o.line.unitPrice.toString(), discountPct: "0", taxRate: o.line.taxRate.toString(), poLineId: o.line.poLineId }))} />}
    </>
  );
}
