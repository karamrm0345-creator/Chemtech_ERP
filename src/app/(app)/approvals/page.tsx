import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, Card, Badge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { D } from "@/lib/decimal";

export const metadata = { title: "My approvals" };

export default async function ApprovalsPage() {
  const user = await requireUser("sales.quotation.approve", "sales.order.approve", "purchase.request.approve", "purchase.order.approve", "inventory.adjust.approve");
  const P = (p: string) => user.permissions.has(p);
  const [limits, q, so, pr, po, sd, counts] = await Promise.all([
    prisma.approvalLimit.findMany({ where: { roleId: user.roleId } }),
    P("sales.quotation.approve") ? prisma.salesQuotation.findMany({ where: { status: "SUBMITTED" }, include: { customer: true } }) : [],
    P("sales.order.approve") ? prisma.salesOrder.findMany({ where: { status: "SUBMITTED" }, include: { customer: true } }) : [],
    P("purchase.request.approve") ? prisma.purchaseRequest.findMany({ where: { status: "SUBMITTED" } }) : [],
    P("purchase.order.approve") ? prisma.purchaseOrder.findMany({ where: { status: "SUBMITTED" }, include: { supplier: true } }) : [],
    P("inventory.adjust.approve") ? prisma.stockDocument.findMany({ where: { status: { in: ["DRAFT", "SUBMITTED"] }, type: { in: ["ADJUSTMENT", "OPENING"] } } }) : [],
    P("inventory.adjust.approve") ? prisma.stockCount.findMany({ where: { status: "DRAFT", lines: { some: { countedQty: { not: null } } } } }) : [],
  ]);
  const users = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const limitFor = (t: string) => limits.find((l) => l.docType === t)?.maxAmount;
  type Row = { type: string; docType: string; id: string; number: string; href: string; party: string; amount: number | null; by: string; byId: string; since: Date };
  const rows: Row[] = [
    ...q.map((x) => ({ type: "Sales quotation", docType: "SALES_QUOTATION", id: x.id, number: x.number, href: `/sales/quotations/${x.id}`, party: x.customer.legalName, amount: D(x.total).mul(D(x.exchangeRate)).toNumber(), by: users.get(x.createdById) ?? "", byId: x.createdById, since: x.updatedAt })),
    ...so.map((x) => ({ type: "Sales order", docType: "SALES_ORDER", id: x.id, number: x.number, href: `/sales/orders/${x.id}`, party: x.customer.legalName, amount: D(x.total).mul(D(x.exchangeRate)).toNumber(), by: users.get(x.createdById) ?? "", byId: x.createdById, since: x.updatedAt })),
    ...pr.map((x) => ({ type: "Purchase request", docType: "PURCHASE_REQUEST", id: x.id, number: x.number, href: `/purchasing/requests/${x.id}`, party: x.department ?? "", amount: Number(x.estimatedTotal), by: users.get(x.requestedById) ?? "", byId: x.requestedById, since: x.updatedAt })),
    ...po.map((x) => ({ type: "Purchase order", docType: "PURCHASE_ORDER", id: x.id, number: x.number, href: `/purchasing/orders/${x.id}`, party: x.supplier.legalName, amount: D(x.total).mul(D(x.exchangeRate)).toNumber(), by: users.get(x.createdById) ?? "", byId: x.createdById, since: x.updatedAt })),
    ...sd.map((x) => ({ type: `Stock ${x.type.toLowerCase()}`, docType: "STOCK_ADJUSTMENT", id: x.id, number: x.number, href: `/inventory/documents/${x.id}`, party: x.reason ?? "", amount: null, by: users.get(x.createdById) ?? "", byId: x.createdById, since: x.updatedAt })),
    ...counts.map((x) => ({ type: "Stock count", docType: "STOCK_ADJUSTMENT", id: x.id, number: x.number, href: `/inventory/counts/${x.id}`, party: "", amount: null, by: users.get(x.createdById) ?? "", byId: x.createdById, since: x.createdAt })),
  ].sort((a, b) => a.since.getTime() - b.since.getTime());
  return (
    <>
      <PageHeader title="My approvals" subtitle="Documents waiting for a decision that your role can approve. You cannot approve documents you prepared." crumbs={[{ label: "Overview" }, { label: "Approvals" }]} />
      {limits.length > 0 && <Card className="mb-4"><p className="text-sm">Your approval limits: {limits.map((l) => <Badge key={l.docType} tone="blue">{l.docType.replace(/_/g, " ").toLowerCase()}: {l.maxAmount === null ? "unlimited" : fmtMoney(l.maxAmount)}</Badge>).reduce((a, b) => <>{a} {b}</>)}</p></Card>}
      <DataTable basePath="/approvals" empty="Nothing waiting for your approval" columns={[{ label: "Document" }, { label: "Number" }, { label: "Customer / supplier / reason" }, { label: "Value (QAR)", align: "right" }, { label: "Prepared by" }, { label: "Waiting since" }, { label: "" }]}
        rows={rows.map((r) => {
          const lim = limitFor(r.docType);
          const over = lim != null && r.amount != null && r.amount > Number(lim);
          return { key: r.id, cells: [r.type, <Link key="n" className="link" href={r.href}>{r.number}</Link>, r.party, r.amount == null ? "—" : fmtMoney(r.amount, ""), r.by, fmtDate(r.since),
            r.byId === user.userId ? <Badge key="b">Your document</Badge> : over ? <Badge key="b" tone="red">Above your limit</Badge> : <Link key="b" className="link text-xs" href={r.href}>Review →</Link>] };
        })} />
    </>
  );
}
