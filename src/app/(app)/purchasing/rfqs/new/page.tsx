import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { toDateInput } from "@/lib/format";
import { RfqForm } from "./form";

export const metadata = { title: "New RFQ" };

export default async function Page({ searchParams }: { searchParams: Promise<{ purchaseRequestId?: string }> }) {
  await requireUser("purchase.rfq.manage");
  const { purchaseRequestId } = await searchParams;
  const pr = purchaseRequestId ? await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId }, include: { lines: { orderBy: { lineNo: "asc" } } } }) : null;
  const items = pr ? await prisma.item.findMany({ where: { id: { in: pr.lines.map((l) => l.itemId!).filter(Boolean) } }, include: { preferredSupplier: true } }) : [];
  const preferred = [...new Map(items.filter((i) => i.preferredSupplier).map((i) => [i.preferredSupplier!.id, { id: i.preferredSupplier!.id, label: i.preferredSupplier!.legalName }])).values()];
  return (
    <>
      <PageHeader title="New request for quotation" crumbs={[{ label: "Procurement" }, { label: "RFQs", href: "/purchasing/rfqs" }, { label: "New" }]} />
      <RfqForm initial={{
        title: pr ? `${pr.number}: ${pr.justification?.slice(0, 80) ?? ""}` : "", purchaseRequestId: pr?.id ?? "", dueDate: toDateInput(new Date(Date.now() + 7 * 86_400_000)), notes: "",
        suppliers: preferred,
        lines: pr ? pr.lines.map((l) => ({ key: l.id, prLineId: l.id, itemId: l.itemId, itemLabel: items.find((i) => i.id === l.itemId)?.code, description: l.description, quantity: l.quantity.sub(l.orderedQty).toString(), uom: l.uom ?? "" })) : [],
      }} />
    </>
  );
}
