import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { parseSerials } from "@/server/services/inventory-engine";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { toDateInput } from "@/lib/format";
import { D } from "@/lib/decimal";
import { ReturnForm } from "./form";

export const metadata = { title: "Customer return" };

export default async function Page({ searchParams }: { searchParams: Promise<{ deliveryId?: string }> }) {
  await requireUser("sales.return.manage");
  const { deliveryId } = await searchParams;
  if (!deliveryId) return <Notice>Open a posted delivery and choose “Customer return”.</Notice>;
  const dlv = await prisma.deliveryOrder.findUnique({ where: { id: deliveryId }, include: { customer: true, lines: true } });
  if (!dlv) notFound();
  const txns = await prisma.inventoryTransaction.findMany({ where: { refDocType: "DeliveryOrder", refDocId: dlv.id } });
  const batchIds = [...new Set(txns.map((t) => t.batchId).filter(Boolean))] as string[];
  const batches = new Map((await prisma.batch.findMany({ where: { id: { in: batchIds } } })).map((b) => [b.id, b.batchNo]));
  const items = new Map((await prisma.item.findMany({ where: { id: { in: dlv.lines.map((l) => l.itemId!).filter(Boolean) } } })).map((i) => [i.id, i]));
  const lines = dlv.lines.map((l) => {
    const rows = txns.filter((t) => t.refLineId === l.id);
    return {
      id: l.id, description: l.description, returnable: D(l.quantity).sub(D(l.returnedQty)).toNumber(),
      batches: [...new Set(rows.map((r) => (r.batchId ? batches.get(r.batchId) : undefined)).filter(Boolean))] as string[],
      serialTracked: !!(l.itemId && items.get(l.itemId)?.serialTracked), serials: rows.flatMap((r) => parseSerials(r.serialNos)),
    };
  }).filter((l) => l.returnable > 0);
  return (
    <>
      <PageHeader title={`Customer return against ${dlv.number}`} subtitle={dlv.customer.legalName}
        crumbs={[{ label: "Sales" }, { label: "Deliveries", href: "/sales/deliveries" }, { label: dlv.number, href: `/sales/deliveries/${dlv.id}` }, { label: "Return" }]} />
      {dlv.status !== "POSTED" ? <Notice tone="warning">Only posted deliveries can be returned against.</Notice>
        : lines.length === 0 ? <Notice>Everything on this delivery has already been returned.</Notice>
        : <ReturnForm deliveryId={dlv.id} lines={lines} today={toDateInput(new Date())} />}
    </>
  );
}
