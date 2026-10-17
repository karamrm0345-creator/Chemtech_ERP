import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { ReturnForm } from "./form";

export const metadata = { title: "Return to supplier" };

export default async function Page({ searchParams }: { searchParams: Promise<{ purchaseOrderId?: string }> }) {
  await requireUser("purchase.return.manage");
  const { purchaseOrderId } = await searchParams;
  if (!purchaseOrderId) return <Notice>Open a purchase order and choose “Return to supplier”.</Notice>;
  const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { supplier: true, lines: { orderBy: { lineNo: "asc" } }, receipts: { where: { status: "POSTED" } } } });
  if (!po) notFound();
  const items = new Map((await prisma.item.findMany({ where: { id: { in: po.lines.map((l) => l.itemId!).filter(Boolean) } } })).map((i) => [i.id, i]));
  const lines = po.lines.filter((l) => l.itemId).map((l) => ({ id: l.id, lineNo: l.lineNo, description: l.description, code: items.get(l.itemId!)?.code ?? "", returnable: Number(l.receivedQty) - Number(l.returnedQty), batch: !!items.get(l.itemId!)?.batchTracked, serial: !!items.get(l.itemId!)?.serialTracked })).filter((l) => l.returnable > 0);
  return (
    <>
      <PageHeader title={`Return to supplier — ${po.number}`} subtitle={po.supplier.legalName} crumbs={[{ label: "Purchase orders", href: "/purchasing/orders" }, { label: po.number, href: `/purchasing/orders/${po.id}` }, { label: "Return" }]} />
      {lines.length === 0 ? <Notice>Nothing received that can be returned.</Notice> : <ReturnForm purchaseOrderId={po.id} receipts={po.receipts.map((r) => ({ value: r.id, label: r.number }))} lines={lines} />}
    </>
  );
}
