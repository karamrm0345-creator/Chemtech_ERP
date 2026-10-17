import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { MasterEditor, LocationEditor } from "./editors";

export const metadata = { title: "Warehouses & setup" };

export default async function SetupPage() {
  await requireUser("item.manage");
  const [whs, cats, uoms] = await Promise.all([
    prisma.warehouse.findMany({ include: { locations: { orderBy: { code: "asc" } } }, orderBy: { code: "asc" } }),
    prisma.itemCategory.findMany({ orderBy: { code: "asc" } }),
    prisma.unitOfMeasure.findMany({ orderBy: { code: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Warehouses & inventory setup" subtitle="Warehouses, bin locations, item categories and units of measure." crumbs={[{ label: "Store & inventory" }, { label: "Setup" }]} />
      <div className="grid gap-4 xl:grid-cols-2">
        <MasterEditor kind="warehouse" title="Warehouses" rows={whs.map((w) => ({ id: w.id, code: w.code, name: w.name, address: w.address ?? "", active: w.active }))} withAddress />
        <LocationEditor warehouses={whs.map((w) => ({ id: w.id, code: w.code, locations: w.locations.map((l) => ({ id: l.id, code: l.code, name: l.name ?? "", active: l.active })) }))} />
        <MasterEditor kind="category" title="Item categories" rows={cats.map((c) => ({ id: c.id, code: c.code, name: c.name, active: c.active }))} />
        <MasterEditor kind="uom" title="Units of measure" rows={uoms.map((u) => ({ id: u.id, code: u.code, name: u.name, active: u.active }))} />
      </div>
    </>
  );
}
