import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { CustomerForm } from "../../customer-form";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("customer.manage");
  const { id } = await params;
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) notFound();
  const currencies = (await prisma.currency.findMany({ where: { active: true } })).map((x) => x.code);
  const rep = c.salesRepId ? await prisma.user.findUnique({ where: { id: c.salesRepId } }) : null;
  return (
    <>
      <PageHeader title={`Edit ${c.legalName}`} crumbs={[{ label: "Customers", href: "/customers" }, { label: c.code, href: `/customers/${c.id}` }, { label: "Edit" }]} />
      <CustomerForm id={c.id} initial={{ ...c, creditLimit: c.creditLimit.toString() }} currencies={currencies} salesRepLabel={rep?.name} />
    </>
  );
}
