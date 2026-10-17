import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { toDateInput } from "@/lib/format";
import { PrForm } from "../../pr-form";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("purchase.request.manage");
  const { id } = await params;
  const pr = await prisma.purchaseRequest.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  if (!pr) notFound();
  if (pr.status !== "DRAFT") redirect(`/purchasing/requests/${id}`);
  const items = new Map((await prisma.item.findMany({ where: { id: { in: pr.lines.map((l) => l.itemId!).filter(Boolean) } } })).map((i) => [i.id, `${i.code} — ${i.name}`]));
  return (
    <>
      <PageHeader title={`Edit ${pr.number}`} crumbs={[{ label: "Purchase requests", href: "/purchasing/requests" }, { label: pr.number, href: `/purchasing/requests/${id}` }, { label: "Edit" }]} />
      <PrForm id={id} initial={{
        department: pr.department ?? "", costCenter: pr.costCenter ?? "", requiredDate: toDateInput(pr.requiredDate), justification: pr.justification ?? "",
        lines: pr.lines.map((l) => ({ key: l.id, itemId: l.itemId, itemLabel: l.itemId ? items.get(l.itemId) : undefined, description: l.description, quantity: l.quantity.toString(), uom: l.uom ?? "", estimatedUnitPrice: l.estimatedUnitPrice.toString(), requiredDate: toDateInput(l.requiredDate) })),
      }} />
    </>
  );
}
