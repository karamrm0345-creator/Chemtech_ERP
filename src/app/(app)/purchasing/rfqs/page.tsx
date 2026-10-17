import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, LinkButton, StatusBadge, Tabs } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { listArgs, str, type SP } from "@/lib/params";
import { fmtDate, fmtMoney, humanize } from "@/lib/format";

export const metadata = { title: "RFQs & supplier offers" };

export default async function RfqsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("purchase.view");
  const sp = await searchParams;
  const tab = str(sp, "tab") ?? "rfqs";
  const a = listArgs(sp);
  const contains = a.q ? { contains: a.q, mode: "insensitive" as const } : undefined;
  return (
    <>
      <PageHeader title="RFQs & supplier offers" crumbs={[{ label: "Procurement" }, { label: "RFQs" }]}
        actions={user.permissions.has("purchase.rfq.manage") && <>
          <LinkButton variant="outline" href="/purchasing/supplier-quotations/new">Record offer without RFQ</LinkButton>
          <LinkButton variant="action" href="/purchasing/rfqs/new"><Plus className="h-4 w-4" /> New RFQ</LinkButton>
        </>} />
      <Tabs active={tab} tabs={[{ key: "rfqs", label: "Requests for quotation", href: "/purchasing/rfqs" }, { key: "offers", label: "Supplier quotations", href: "/purchasing/rfqs?tab=offers" }]} />
      <ListToolbar placeholder="Search…" />
      {tab === "rfqs" ? await (async () => {
        const rows = await prisma.rfq.findMany({ where: contains ? { OR: [{ number: contains }, { title: contains }] } : {}, include: { _count: { select: { suppliers: true, quotations: true } }, purchaseRequest: { select: { number: true } } }, orderBy: { date: "desc" }, take: 200 });
        return <DataTable basePath="/purchasing/rfqs" sp={sp} empty="No RFQs" columns={[{ label: "RFQ" }, { label: "Title" }, { label: "Date" }, { label: "Due" }, { label: "PR" }, { label: "Suppliers", align: "right" }, { label: "Offers", align: "right" }, { label: "Status" }]}
          rows={rows.map((r) => ({ key: r.id, cells: [<Link key="n" className="link" href={`/purchasing/rfqs/${r.id}`}>{r.number}</Link>, r.title, fmtDate(r.date), fmtDate(r.dueDate), r.purchaseRequest?.number, r._count.suppliers, r._count.quotations, <StatusBadge key="s" status={r.status} />] }))} />;
      })() : await (async () => {
        const rows = await prisma.supplierQuotation.findMany({ where: contains ? { OR: [{ number: contains }, { supplierRef: contains }, { supplier: { legalName: contains } }] } : {}, include: { supplier: true, rfq: { select: { number: true } } }, orderBy: { date: "desc" }, take: 200 });
        return <DataTable basePath="/purchasing/rfqs" sp={sp} empty="No supplier quotations" columns={[{ label: "Number" }, { label: "Supplier" }, { label: "Supplier ref." }, { label: "RFQ" }, { label: "Date" }, { label: "Delivery" }, { label: "Compliance" }, { label: "Total", align: "right" }, { label: "Status" }]}
          rows={rows.map((q) => ({ key: q.id, cells: [<Link key="n" className="link" href={`/purchasing/supplier-quotations/${q.id}`}>{q.number}</Link>, q.supplier.legalName, q.supplierRef, q.rfq?.number, fmtDate(q.date), q.deliveryDays != null ? `${q.deliveryDays} d` : "—", humanize(q.technicalCompliance), fmtMoney(q.total, q.currency), <StatusBadge key="s" status={q.status} />] }))} />;
      })()}
    </>
  );
}
