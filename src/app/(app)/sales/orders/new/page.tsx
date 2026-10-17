import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { SalesDocForm } from "../../sales-doc-form";
import { salesFormOptions, toDateInput } from "../../data";

export const metadata = { title: "New sales order" };

export default async function Page({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  await requireUser("sales.order.manage");
  const { customerId } = await searchParams;
  const o = await salesFormOptions();
  const c = customerId ? await prisma.customer.findUnique({ where: { id: customerId } }) : null;
  return (
    <>
      <PageHeader title="New sales order" crumbs={[{ label: "Sales" }, { label: "Sales orders", href: "/sales/orders" }, { label: "New" }]} />
      <SalesDocForm kind="order" id={null} {...o} initial={{
        customerId: c?.id ?? null, customerLabel: c?.legalName, currency: c?.currency ?? "QAR", paymentTerms: c?.paymentTerms ?? "", shippingAddress: c?.address ?? "",
        date: toDateInput(new Date()), warehouseId: o.warehouses[0]?.value ?? "", lines: [],
      }} />
    </>
  );
}
