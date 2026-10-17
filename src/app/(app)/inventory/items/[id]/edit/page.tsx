import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { ItemForm } from "../../item-form";
import { itemFormOptions } from "../../data";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("item.manage");
  const { id } = await params;
  const item = await prisma.item.findUnique({ where: { id }, include: { preferredSupplier: true } });
  if (!item) notFound();
  const [o, moves] = await Promise.all([itemFormOptions(), prisma.inventoryTransaction.count({ where: { itemId: id } })]);
  const { preferredSupplier, ...rest } = item;
  const initial = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v && typeof v === "object" && "toFixed" in v ? v.toString() : v]));
  return (
    <>
      <PageHeader title={`Edit ${item.code}`} crumbs={[{ label: "Items", href: "/inventory/items" }, { label: item.code, href: `/inventory/items/${id}` }, { label: "Edit" }]} />
      <ItemForm id={id} hasMovements={moves > 0} {...o} initial={initial} supplierLabel={preferredSupplier?.legalName} />
    </>
  );
}
