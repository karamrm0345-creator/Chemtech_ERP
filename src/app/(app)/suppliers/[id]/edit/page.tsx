import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { getSupplier } from "@/server/services/suppliers";
import { PageHeader } from "@/components/ui/primitives";
import { SupplierForm } from "../../supplier-form";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser("supplier.manage");
  const { id } = await params;
  const s = await getSupplier(u, id).catch(() => null);
  if (!s) notFound();
  const currencies = (await prisma.currency.findMany({ where: { active: true } })).map((c) => c.code);
  const { contacts: _c, documents: _d, issues: _i, ...rest } = s;
  return (
    <>
      <PageHeader title={`Edit ${s.legalName}`} crumbs={[{ label: "Suppliers", href: "/suppliers" }, { label: s.code, href: `/suppliers/${s.id}` }, { label: "Edit" }]} />
      <SupplierForm id={s.id} initial={{ ...rest, rating: s.rating?.toString() ?? "" }} currencies={currencies} canBank={u.permissions.has("supplier.bank.manage")} />
    </>
  );
}
