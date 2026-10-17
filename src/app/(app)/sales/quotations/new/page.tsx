import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { SalesDocForm } from "../../sales-doc-form";
import { salesFormOptions, toDateInput } from "../../data";

export const metadata = { title: "New quotation" };

export default async function Page({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  await requireUser("sales.quotation.manage");
  const { customerId } = await searchParams;
  const o = await salesFormOptions();
  const c = customerId ? await prisma.customer.findUnique({ where: { id: customerId } }) : null;
  return (
    <>
      <PageHeader title="New sales quotation" crumbs={[{ label: "Sales" }, { label: "Quotations", href: "/sales/quotations" }, { label: "New" }]} />
      <SalesDocForm kind="quotation" id={null} {...o} initial={{
        customerId: c?.id ?? null, customerLabel: c?.legalName, currency: c?.currency ?? "QAR", paymentTerms: c?.paymentTerms ?? "",
        date: toDateInput(new Date()), validUntil: toDateInput(new Date(Date.now() + 30 * 86_400_000)), lines: [],
      }} />
    </>
  );
}
