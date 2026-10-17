import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { DeliveryForm } from "./form";
import { toDateInput } from "@/lib/format";

export const metadata = { title: "New delivery" };

export default async function Page({ searchParams }: { searchParams: Promise<{ salesOrderId?: string }> }) {
  await requireUser("sales.delivery.manage");
  const { salesOrderId } = await searchParams;
  if (!salesOrderId) return <Notice>Open an approved sales order and choose “Create delivery”.</Notice>;
  const so = await prisma.salesOrder.findUnique({ where: { id: salesOrderId }, include: { customer: true, lines: { orderBy: { lineNo: "asc" } } } });
  if (!so) notFound();
  const pending = await prisma.deliveryOrderLine.groupBy({ by: ["salesOrderLineId"], where: { delivery: { salesOrderId, status: "DRAFT" } }, _sum: { quantity: true } });
  const items = new Map((await prisma.item.findMany({ where: { id: { in: so.lines.map((l) => l.itemId!).filter(Boolean) } } })).map((i) => [i.id, i]));
  const lines = so.lines.map((l) => {
    const it = l.itemId ? items.get(l.itemId) : undefined;
    const open = Number(l.quantity) - Number(l.deliveredQty) - Number(pending.find((p) => p.salesOrderLineId === l.id)?._sum.quantity ?? 0);
    return { id: l.id, lineNo: l.lineNo, code: it?.code ?? "", description: l.description, uom: l.uom ?? "", open: Math.max(open, 0), batch: !!it?.batchTracked, serial: !!it?.serialTracked };
  }).filter((l) => l.open > 0);
  return (
    <>
      <PageHeader title={`Delivery for ${so.number}`} subtitle={so.customer.legalName} crumbs={[{ label: "Sales orders", href: "/sales/orders" }, { label: so.number, href: `/sales/orders/${so.id}` }, { label: "New delivery" }]} />
      {lines.length === 0 ? <Notice>Nothing left to deliver on this order (or the remainder is already on draft deliveries).</Notice>
        : <DeliveryForm salesOrderId={so.id} lines={lines} defaults={{ date: toDateInput(new Date()), shippingAddress: so.shippingAddress ?? so.customer.address ?? "" }} />}
    </>
  );
}
