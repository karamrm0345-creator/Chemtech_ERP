import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Tabs } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { str, type SP } from "@/lib/params";
import { fmtDate, fmtQty } from "@/lib/format";

export const metadata = { title: "Batches & serials" };

export default async function TracePage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser("inventory.view");
  const sp = await searchParams;
  const tab = str(sp, "tab") ?? "batches";
  const q = str(sp, "q");
  const contains = q ? { contains: q, mode: "insensitive" as const } : undefined;
  const whs = new Map((await prisma.warehouse.findMany()).map((w) => [w.id, w.code]));
  const now = Date.now();
  return (
    <>
      <PageHeader title="Batch & serial traceability" subtitle="Trace lots and serialized equipment from goods receipt to delivery." crumbs={[{ label: "Store & inventory" }, { label: "Traceability" }]} />
      <Tabs active={tab} tabs={[{ key: "batches", label: "Batches / lots", href: "/inventory/traceability" }, { key: "serials", label: "Serial numbers", href: "/inventory/traceability?tab=serials" }]} />
      <ListToolbar placeholder={tab === "batches" ? "Search batch no. or item…" : "Search serial no. or item…"} />
      {tab === "batches" ? await (async () => {
        const batches = await prisma.batch.findMany({
          where: contains ? { OR: [{ batchNo: contains }, { item: { code: contains } }, { item: { name: contains } }] } : {},
          include: { item: true, balances: true }, orderBy: [{ expiryDate: "asc" }], take: 300,
        });
        return <DataTable basePath="/inventory/traceability" sp={sp} empty="No batches" columns={[{ label: "Batch / lot" }, { label: "Item" }, { label: "Certificate" }, { label: "Expiry" }, { label: "In stock", align: "right" }, { label: "Where" }, { label: "Status" }, { label: "" }]}
          rows={batches.map((b) => {
            const qty = b.balances.reduce((s, x) => s + Number(x.quantity), 0);
            const exp = b.expiryDate?.getTime();
            return { key: b.id, cells: [<span key="b" className="font-mono">{b.batchNo}</span>, <Link key="i" className="link" href={`/inventory/items/${b.itemId}`}>{b.item.code}</Link>, b.certificateNo, fmtDate(b.expiryDate), fmtQty(qty),
              b.balances.filter((x) => Number(x.quantity) !== 0).map((x) => `${whs.get(x.warehouseId)}: ${fmtQty(x.quantity)}`).join(", "),
              exp === undefined ? <StatusBadge key="s" status="OK" label="No expiry" /> : exp < now ? <StatusBadge key="s" status="EXPIRED" /> : exp < now + 90 * 86_400_000 ? <StatusBadge key="s" status="LOW" label="Expiring ≤ 90d" /> : <StatusBadge key="s" status="OK" label="Valid" />,
              <Link key="l" className="link text-xs" href={`/inventory/ledger?q=${encodeURIComponent(b.item.code)}`}>movements</Link>] };
          })} />;
      })() : await (async () => {
        const serials = await prisma.serialNumber.findMany({
          where: contains ? { OR: [{ serialNo: contains }, { item: { code: contains } }, { item: { name: contains } }] } : {},
          include: { item: true }, orderBy: { serialNo: "asc" }, take: 300,
        });
        const moves = await prisma.inventoryTransaction.findMany({ where: { serialNos: { not: null }, itemId: { in: serials.map((s) => s.itemId) } }, orderBy: { seq: "desc" } });
        return <DataTable basePath="/inventory/traceability" sp={sp} empty="No serial numbers" columns={[{ label: "Serial no." }, { label: "Item" }, { label: "Status" }, { label: "Warehouse" }, { label: "Last movement" }, { label: "Next inspection" }]}
          rows={serials.map((s) => {
            const last = moves.find((m) => m.itemId === s.itemId && m.serialNos!.split(",").includes(s.serialNo));
            return { key: s.id, cells: [<span key="s" className="font-mono">{s.serialNo}</span>, <Link key="i" className="link" href={`/inventory/items/${s.itemId}`}>{s.item.code} — {s.item.name}</Link>, <StatusBadge key="st" status={s.status} />, s.warehouseId ? whs.get(s.warehouseId) : "—", last ? `${last.refDocNo} · ${fmtDate(last.txnDate)}` : "—", fmtDate(s.nextInspectionDate)] };
          })} />;
      })()}
    </>
  );
}
