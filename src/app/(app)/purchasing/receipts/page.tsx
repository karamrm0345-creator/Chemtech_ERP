import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listGoodsReceipts } from "@/server/services/purchasing";
import { PageHeader, StatusBadge, LinkButton } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { listArgs, str, type SP } from "@/lib/params";
import { fmtDate } from "@/lib/format";
import { opts } from "@/lib/options";

export const metadata = { title: "Goods receipts" };

export default async function GrnList({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("purchase.view");
  const sp = await searchParams;
  const data = await listGoodsReceipts(user, { ...listArgs(sp), status: str(sp, "status") });
  return (
    <>
      <PageHeader title="Goods receipts" subtitle="Receive goods against approved purchase orders. Posting increases stock exactly once." crumbs={[{ label: "Procurement" }, { label: "Goods receipts" }]}
        actions={<LinkButton variant="outline" href="/purchasing/orders?status=OPEN">Open purchase orders</LinkButton>} />
      <ListToolbar placeholder="Search GRN, PO or supplier…" filters={[{ name: "status", label: "Status", options: opts(["DRAFT", "POSTED", "CANCELLED"]) }]} />
      <DataTable basePath="/purchasing/receipts" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No goods receipts" emptyHint="Open an approved purchase order and choose “Receive goods”."
        columns={[{ label: "GRN", sort: "number" }, { label: "Date", sort: "date" }, { label: "Purchase order" }, { label: "Supplier" }, { label: "Delivery note" }, { label: "Status", sort: "status" }]}
        rows={data.rows.map((g) => ({ key: g.id, cells: [<Link key="n" className="link" href={`/purchasing/receipts/${g.id}`}>{g.number}</Link>, fmtDate(g.date), <Link key="p" className="link" href={`/purchasing/orders/${g.purchaseOrderId}`}>{g.purchaseOrder.number}</Link>, g.supplier.legalName, g.supplierDeliveryNote, <StatusBadge key="s" status={g.status} />] }))} />
    </>
  );
}
