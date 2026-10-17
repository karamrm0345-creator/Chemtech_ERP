import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { SalesDocForm } from "../../../sales-doc-form";
import { salesFormOptions, toLineStates, toDateInput } from "../../../data";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("sales.order.manage");
  const { id } = await params;
  const so = await prisma.salesOrder.findUnique({ where: { id }, include: { customer: true, lines: { orderBy: { lineNo: "asc" } } } });
  if (!so) notFound();
  if (so.status !== "DRAFT") redirect(`/sales/orders/${id}`);
  const o = await salesFormOptions();
  return (
    <>
      <PageHeader title={`Edit ${so.number}`} crumbs={[{ label: "Sales orders", href: "/sales/orders" }, { label: so.number, href: `/sales/orders/${id}` }, { label: "Edit" }]} />
      <SalesDocForm kind="order" id={id} {...o} initial={{
        customerId: so.customerId, customerLabel: so.customer.legalName, contactId: so.contactId ?? "", currency: so.currency, date: toDateInput(so.date),
        customerPoRef: so.customerPoRef ?? "", requiredDate: toDateInput(so.requiredDate), warehouseId: so.warehouseId, shippingAddress: so.shippingAddress ?? "",
        paymentTerms: so.paymentTerms ?? "", deliveryTerms: so.deliveryTerms ?? "", notes: so.notes ?? "", lines: await toLineStates(so.lines),
      }} />
    </>
  );
}
