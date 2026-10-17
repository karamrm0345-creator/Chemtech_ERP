import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { SupplierForm } from "../supplier-form";

export const metadata = { title: "New supplier" };

export default async function Page() {
  const u = await requireUser("supplier.manage");
  const currencies = (await prisma.currency.findMany({ where: { active: true } })).map((c) => c.code);
  return (
    <>
      <PageHeader title="New supplier" crumbs={[{ label: "Suppliers", href: "/suppliers" }, { label: "New" }]} />
      <SupplierForm id={null} initial={{ category: "OTHER", country: "Qatar", currency: "QAR", paymentTermDays: 30, prequalStatus: "NOT_STARTED", active: true }} currencies={currencies} canBank={u.permissions.has("supplier.bank.manage")} />
    </>
  );
}
