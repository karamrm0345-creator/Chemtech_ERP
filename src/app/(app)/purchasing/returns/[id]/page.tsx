import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Card, KeyValues } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { HistoryPanel } from "@/components/panels";
import { PrintButton } from "@/components/print-button";
import { fmtDate, fmtQty } from "@/lib/format";

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("purchase.view");
  const { id } = await params;
  const r = await prisma.purchaseReturn.findUnique({ where: { id }, include: { lines: true, supplier: true } });
  if (!r) notFound();
  const [po, items] = await Promise.all([
    prisma.purchaseOrder.findUnique({ where: { id: r.purchaseOrderId }, select: { id: true, number: true } }),
    prisma.item.findMany({ where: { id: { in: r.lines.map((l) => l.itemId) } } }),
  ]);
  const it = new Map(items.map((i) => [i.id, i]));
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{r.number} <StatusBadge status={r.status} /></span>} subtitle={`Return to ${r.supplier.legalName}`}
        crumbs={[{ label: "Purchase orders", href: "/purchasing/orders" }, { label: po?.number ?? "", href: `/purchasing/orders/${r.purchaseOrderId}` }, { label: r.number }]} actions={<PrintButton />} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card><KeyValues items={[["Date", fmtDate(r.date)], ["Purchase order", po ? <Link className="link" href={`/purchasing/orders/${po.id}`}>{po.number}</Link> : ""], ["Reason", r.reason]]} /></Card>
          <DataTable basePath={`/purchasing/returns/${id}`} columns={[{ label: "Item" }, { label: "Qty", align: "right" }, { label: "Batch" }, { label: "Serials" }]}
            rows={r.lines.map((l) => ({ key: l.id, cells: [`${it.get(l.itemId)?.code} — ${it.get(l.itemId)?.name}`, fmtQty(l.quantity), l.batchNo, l.serialNos] }))} />
        </div>
        <HistoryPanel entity="PurchaseReturn" entityId={id} />
      </div>
    </>
  );
}
