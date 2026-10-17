import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "New customer" };

export default async function Page() {
  await requireUser("customer.manage");
  const currencies = (await prisma.currency.findMany({ where: { active: true } })).map((c) => c.code);
  return (
    <>
      <PageHeader title="New customer" crumbs={[{ label: "Customers", href: "/customers" }, { label: "New" }]} />
      <CustomerForm id={null} initial={{ category: "OTHER", country: "Qatar", currency: "QAR", paymentTermDays: 30, creditLimit: 0, active: true }} currencies={currencies} />
    </>
  );
}
