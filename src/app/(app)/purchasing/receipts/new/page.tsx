import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { toDateInput } from "@/lib/format";
import { GrnForm } from "./form";

export const metadata = { title: "Receive goods" };

export default async function Page({ searchParams }: { searchParams: Promise<{ purchaseOrderId?: string }> }) {
  await requireUser("purchase.receipt.manage");
  const { purchaseOrderId } = await searchParams;
  if (!purchaseOrderId) return <Notice>Open an approved purchase order and choose “Receive goods”.</Notice>;
  const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { supplier: true, lines: { orderBy: { lineNo: "asc" } } } });
  if (!po) notFound();
  const [items, settings, locs] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: po.lines.map((l) => l.itemId!).filter(Boolean) } } }),
    prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.warehouseLocation.findMany({ where: { warehouseId: po.warehouseId, active: true }, orderBy: { code: "asc" } }),
  ]);
  const it = new Map(items.map((i) => [i.id, i]));
  const lines = po.lines.map((l) => {
    const i = l.itemId ? it.get(l.itemId) : undefined;
    const outstanding = Number(l.quantity) - Number(l.receivedQty) + Number(l.returnedQty);
    return { id: l.id, lineNo: l.lineNo, code: i?.code ?? "", description: l.description, uom: l.uom ?? "", ordered: Number(l.quantity), outstanding: Math.max(outstanding, 0),
      batch: !!i?.batchTracked, expiry: !!i?.expiryTracked, serial: !!i?.serialTracked, stocked: !!i && i.itemType !== "SERVICE" && i.inventoryClass !== "NON_STOCK", defaultLocationId: i?.defaultLocationId ?? "" };
  }).filter((l) => l.outstanding > 0);
  return (
    <>
      <PageHeader title={`Receive goods — ${po.number}`} subtitle={po.supplier.legalName} crumbs={[{ label: "Purchase orders", href: "/purchasing/orders" }, { label: po.number, href: `/purchasing/orders/${po.id}` }, { label: "Receive" }]} />
      {lines.length === 0 ? <Notice>All lines are fully received.</Notice> : (
        <>
          <div className="mb-4"><Notice>Tolerance: receipts may exceed ordered quantity by at most {settings.grnTolerancePct.toString()}%. {po.allowPartial ? "Partial receipts are allowed." : "This PO does not allow partial deliveries."} Rejected quantities stay outstanding and are logged as supplier nonconformities.</Notice></div>
          <GrnForm purchaseOrderId={po.id} lines={lines} date={toDateInput(new Date())} locations={locs.map((l) => ({ value: l.id, label: l.code }))} />
        </>
      )}
    </>
  );
}
