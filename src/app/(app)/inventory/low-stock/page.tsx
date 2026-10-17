import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { lowStockSuggestions } from "@/server/services/purchasing";
import { PageHeader } from "@/components/ui/primitives";
import { LowStockTable } from "./table";

export const metadata = { title: "Low stock" };

export default async function LowStockPage() {
  const user = await requireUser("inventory.view");
  const rows = await lowStockSuggestions(prisma);
  return (
    <>
      <PageHeader title="Low-stock alerts" subtitle="Items at or below their minimum stock level. Suggestions take reservations and open purchase orders into account."
        crumbs={[{ label: "Store & inventory" }, { label: "Low stock" }]} />
      <LowStockTable canPr={user.permissions.has("purchase.request.manage")} rows={rows.map((r) => ({
        id: r.item.id, code: r.item.code, name: r.item.name, uom: r.item.uom.code, min: r.item.minStockLevel.toString(), onHand: r.onHand.toString(),
        reserved: r.reserved.toString(), onOrder: r.onOrder.toString(), suggested: r.suggested.toString(), supplier: r.item.preferredSupplier?.legalName ?? "",
      }))} />
    </>
  );
}
