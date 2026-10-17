import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { PrForm, type PrLine } from "../pr-form";

export const metadata = { title: "New purchase request" };

export default async function Page({ searchParams }: { searchParams: Promise<{ itemId?: string }> }) {
  const user = await requireUser("purchase.request.manage");
  const { itemId } = await searchParams;
  const item = itemId ? await prisma.item.findUnique({ where: { id: itemId }, include: { uom: true } }) : null;
  const me = await prisma.user.findUnique({ where: { id: user.userId } });
  const lines: PrLine[] = item ? [{ key: "1", itemId: item.id, itemLabel: `${item.code} — ${item.name}`, description: item.name, quantity: (Number(item.reorderQty) || 1).toString(), uom: item.uom.code, estimatedUnitPrice: item.purchasePrice.toString(), requiredDate: "" }] : [];
  return (
    <>
      <PageHeader title="New purchase request" crumbs={[{ label: "Procurement" }, { label: "Purchase requests", href: "/purchasing/requests" }, { label: "New" }]} />
      <PrForm id={null} initial={{ department: me?.department ?? "", costCenter: "", requiredDate: "", justification: "", lines }} />
    </>
  );
}
