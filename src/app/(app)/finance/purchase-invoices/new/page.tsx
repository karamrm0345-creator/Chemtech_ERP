import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma, type Tx } from "@/server/db";
import { unbilledCharges } from "@/server/services/finance";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { toDateInput } from "@/lib/format";
import { PiForm } from "./form";

export const metadata = { title: "Record supplier invoice" };

export default async function Page({ searchParams }: { searchParams: Promise<{ purchaseOrderId?: string }> }) {
  await requireUser("finance.purchase.manage");
  const { purchaseOrderId } = await searchParams;
  if (!purchaseOrderId) return <Notice>Open a purchase order and choose “Record invoice”.</Notice>;
  const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { supplier: true, lines: { orderBy: { lineNo: "asc" } } } });
  if (!po) notFound();
  const lines = po.lines.map((l) => {
    const open = Number(l.receivedQty) - Number(l.returnedQty) - Number(l.invoicedQty);
    const net = Number(l.quantity) ? Number(l.lineTotal) / Number(l.quantity) : 0;
    return { id: l.id, lineNo: l.lineNo, description: l.description, open: Math.max(open, 0), poUnit: (Math.round(net * 100) / 100).toString(), taxRate: l.taxRate.toString() };
  }).filter((l) => l.open > 0);
  const charges = (await unbilledCharges(prisma as unknown as Tx, po.id)).toFixed(2);
  return (
    <>
      <PageHeader title={`Supplier invoice for ${po.number}`} subtitle={po.supplier.legalName} crumbs={[{ label: "Purchase orders", href: "/purchasing/orders" }, { label: po.number, href: `/purchasing/orders/${po.id}` }, { label: "Invoice" }]} />
      {lines.length === 0 ? <Notice>All received quantities have been invoiced.</Notice> : <PiForm purchaseOrderId={po.id} currency={po.currency} lines={lines} date={toDateInput(new Date())} charges={charges} />}
    </>
  );
}
