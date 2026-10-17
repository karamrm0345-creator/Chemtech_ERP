import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { toDateInput } from "@/lib/format";
import { SupplierQuoteForm } from "./form";

export const metadata = { title: "Record supplier quotation" };

export default async function Page({ searchParams }: { searchParams: Promise<{ rfqId?: string; supplierId?: string }> }) {
  await requireUser("purchase.rfq.manage");
  const { rfqId, supplierId } = await searchParams;
  const [rfq, supplier, criteria, currencies] = await Promise.all([
    rfqId ? prisma.rfq.findUnique({ where: { id: rfqId }, include: { lines: { orderBy: { lineNo: "asc" } } } }) : null,
    supplierId ? prisma.supplier.findUnique({ where: { id: supplierId } }) : null,
    prisma.evaluationCriterion.findMany({ where: { active: true }, orderBy: { sort: "asc" } }),
    prisma.currency.findMany({ where: { active: true } }),
  ]);
  const items = rfq ? new Map((await prisma.item.findMany({ where: { id: { in: rfq.lines.map((l) => l.itemId!).filter(Boolean) } } })).map((i) => [i.id, i])) : new Map();
  return (
    <>
      <PageHeader title="Record supplier quotation" subtitle={rfq ? `For ${rfq.number}: ${rfq.title}` : "Offer received without an RFQ"} crumbs={[{ label: "Procurement" }, { label: "RFQs", href: "/purchasing/rfqs" }, { label: "New offer" }]} />
      <SupplierQuoteForm currencies={currencies.map((c) => c.code)} criteria={criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight.toString() }))}
        initial={{
          rfqId: rfq?.id ?? "", supplierId: supplier?.id ?? null, supplierLabel: supplier?.legalName, currency: supplier?.currency ?? "QAR", paymentTerms: supplier?.paymentTerms ?? "",
          date: toDateInput(new Date()),
          lines: rfq ? rfq.lines.map((l) => ({ key: l.id, rfqLineId: l.id, itemId: l.itemId, itemLabel: l.itemId ? `${items.get(l.itemId)?.code} — ${items.get(l.itemId)?.name}` : undefined, description: l.description, quantity: l.quantity.toString(), uom: l.uom ?? "", unitPrice: "0", discountPct: "0", taxRate: "0" })) : [],
        }} />
    </>
  );
}
