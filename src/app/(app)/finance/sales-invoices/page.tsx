import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { listSalesInvoices } from "@/server/services/finance";
import { PageHeader, StatusBadge, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { listArgs, str, type SP } from "@/lib/params";
import { fmtDate, fmtMoney, fmtAmount } from "@/lib/format";
import { D } from "@/lib/decimal";

export const metadata = { title: "Sales invoices" };

export default async function SiList({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("finance.view");
  const sp = await searchParams;
  const status = str(sp, "status");
  const [data, s] = await Promise.all([
    listSalesInvoices(user, { ...listArgs(sp), status: status === "OVERDUE" ? undefined : status, overdue: status === "OVERDUE" }),
    prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } }),
  ]);
  const now = new Date();
  return (
    <>
      <PageHeader title="Sales invoices" subtitle="Invoices are raised from sales orders (stocked lines after delivery). Posted invoices drive confirmed revenue and receivables." crumbs={[{ label: "Finance" }, { label: "Sales invoices" }]} />
      {!s.financeEnabled && <div className="mb-4"><Notice tone="warning">Finance is disabled in company settings. Existing records are read-only.</Notice></div>}
      <ListToolbar placeholder="Search invoice or customer…" filters={[{ name: "status", label: "Status", options: [{ value: "OPEN", label: "Outstanding" }, { value: "OVERDUE", label: "Overdue" }, { value: "DRAFT", label: "Draft" }, { value: "PAID", label: "Paid" }, { value: "CANCELLED", label: "Cancelled" }] }]} />
      <DataTable basePath="/finance/sales-invoices" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No invoices" emptyHint="Open a sales order and choose “Invoice”."
        columns={[{ label: "Invoice", sort: "number" }, { label: "Date", sort: "date" }, { label: "Customer" }, { label: "Sales order" }, { label: "Due", sort: "dueDate" }, { label: "Total", sort: "total", align: "right" }, { label: "Balance", align: "right" }, { label: "Status", sort: "status" }]}
        rows={data.rows.map((i) => {
          const overdue = ["POSTED", "PARTIALLY_PAID"].includes(i.status) && i.dueDate < now;
          return { key: i.id, cells: [<Link key="n" className="link" href={`/finance/sales-invoices/${i.id}`}>{i.number}</Link>, fmtDate(i.date), i.customer.legalName, i.salesOrder?.number, <span key="d" className={overdue ? "font-semibold text-red-600" : ""}>{fmtDate(i.dueDate)}</span>, fmtMoney(i.total, i.currency), fmtAmount(D(i.total).sub(D(i.paidAmount))), <StatusBadge key="s" status={overdue ? "OVERDUE" : i.status} />] };
        })} />
    </>
  );
}
