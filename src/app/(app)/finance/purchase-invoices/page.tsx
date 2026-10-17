import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listPurchaseInvoices } from "@/server/services/finance";
import { PageHeader, StatusBadge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { listArgs, str, type SP } from "@/lib/params";
import { fmtDate, fmtMoney, fmtAmount } from "@/lib/format";
import { D } from "@/lib/decimal";

export const metadata = { title: "Supplier invoices" };

export default async function PiList({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("finance.view");
  const sp = await searchParams;
  const data = await listPurchaseInvoices(user, { ...listArgs(sp), status: str(sp, "status") });
  return (
    <>
      <PageHeader title="Supplier invoices" subtitle="Recorded against purchase orders with 3-way matching (PO price × received quantity)." crumbs={[{ label: "Finance" }, { label: "Supplier invoices" }]} />
      <ListToolbar placeholder="Search reference, supplier invoice no. or supplier…" filters={[{ name: "status", label: "Status", options: [{ value: "OPEN", label: "Outstanding" }, { value: "DRAFT", label: "Draft" }, { value: "PAID", label: "Paid" }] }]} />
      <DataTable basePath="/finance/purchase-invoices" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No supplier invoices" emptyHint="Open a purchase order with received goods and choose “Record invoice”."
        columns={[{ label: "Ref", sort: "number" }, { label: "Supplier inv." }, { label: "Supplier" }, { label: "PO" }, { label: "Date", sort: "date" }, { label: "Due", sort: "dueDate" }, { label: "Total", sort: "total", align: "right" }, { label: "Balance", align: "right" }, { label: "Match" }, { label: "Status", sort: "status" }]}
        rows={data.rows.map((i) => ({ key: i.id, cells: [<Link key="n" className="link" href={`/finance/purchase-invoices/${i.id}`}>{i.number}</Link>, i.supplierInvoiceNo, i.supplier.legalName, i.purchaseOrder?.number, fmtDate(i.date), fmtDate(i.dueDate), fmtMoney(i.total, i.currency), fmtAmount(D(i.total).sub(D(i.paidAmount))), <StatusBadge key="m" status={i.matchStatus} />, <StatusBadge key="s" status={i.status} />] }))} />
    </>
  );
}
