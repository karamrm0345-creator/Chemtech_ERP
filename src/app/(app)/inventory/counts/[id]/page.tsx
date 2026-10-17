import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Notice } from "@/components/ui/primitives";
import { ActionButton } from "@/components/forms/action-button";
import { postCountAction } from "@/app/actions/inventory";
import { CountSheet } from "./sheet";

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("inventory.count", "inventory.adjust.approve");
  const { id } = await params;
  const c = await prisma.stockCount.findUnique({ where: { id }, include: { lines: true } });
  if (!c) notFound();
  const [items, batches, wh] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: c.lines.map((l) => l.itemId) } }, include: { uom: true } }),
    prisma.batch.findMany({ where: { id: { in: c.lines.map((l) => l.batchId!).filter(Boolean) } } }),
    prisma.warehouse.findUniqueOrThrow({ where: { id: c.warehouseId } }),
  ]);
  const it = new Map(items.map((i) => [i.id, i]));
  const bt = new Map(batches.map((b) => [b.id, b.batchNo]));
  const rows = c.lines.map((l) => ({
    id: l.id, code: it.get(l.itemId)?.code ?? "", name: it.get(l.itemId)?.name ?? "", uom: it.get(l.itemId)?.uom.code ?? "",
    batch: l.batchId ? bt.get(l.batchId) ?? "" : "", systemQty: l.systemQty.toString(), countedQty: l.countedQty?.toString() ?? "",
  })).sort((a, b) => a.code.localeCompare(b.code));
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{c.number} <StatusBadge status={c.status} /></span>} subtitle={`Warehouse ${wh.code} — ${wh.name}`}
        crumbs={[{ label: "Stock counts", href: "/inventory/counts" }, { label: c.number }]}
        actions={c.status === "DRAFT" && user.permissions.has("inventory.adjust.approve") && c.createdById !== user.userId &&
          <ActionButton variant="action" label="Approve & post variances" confirm="Variances against current balances will be posted to the ledger. Continue?" action={postCountAction.bind(null, id)} />} />
      {c.status === "DRAFT" && <div className="mb-4"><Notice>Enter counted quantities and save. Leave blank for items not counted. Variances are calculated against the <b>current</b> balance when posted, so stock moving during the count is respected. A different user with approval rights posts the result.</Notice></div>}
      <CountSheet countId={id} rows={rows} editable={c.status === "DRAFT" && user.permissions.has("inventory.count")} />
    </>
  );
}
