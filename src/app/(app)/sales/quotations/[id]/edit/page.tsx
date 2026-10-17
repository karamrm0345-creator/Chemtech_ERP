import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { SalesDocForm } from "../../../sales-doc-form";
import { salesFormOptions, toLineStates, toDateInput } from "../../../data";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("sales.quotation.manage");
  const { id } = await params;
  const q = await prisma.salesQuotation.findUnique({ where: { id }, include: { customer: true, lines: { orderBy: { lineNo: "asc" } } } });
  if (!q) notFound();
  if (q.status !== "DRAFT") redirect(`/sales/quotations/${id}`);
  const o = await salesFormOptions();
  return (
    <>
      <PageHeader title={`Edit ${q.number}`} crumbs={[{ label: "Quotations", href: "/sales/quotations" }, { label: q.number, href: `/sales/quotations/${id}` }, { label: "Edit" }]} />
      <SalesDocForm kind="quotation" id={id} {...o} initial={{
        customerId: q.customerId, customerLabel: q.customer.legalName, contactId: q.contactId ?? "", currency: q.currency, date: toDateInput(q.date),
        reference: q.reference ?? "", validUntil: toDateInput(q.validUntil), paymentTerms: q.paymentTerms ?? "", deliveryTerms: q.deliveryTerms ?? "", notes: q.notes ?? "",
        lines: await toLineStates(q.lines),
      }} />
    </>
  );
}
