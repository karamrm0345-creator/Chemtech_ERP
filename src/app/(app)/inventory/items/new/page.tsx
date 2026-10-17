import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { ItemForm } from "../item-form";
import { itemFormOptions } from "../data";

export const metadata = { title: "New item" };

export default async function Page() {
  await requireUser("item.manage");
  const o = await itemFormOptions();
  return (
    <>
      <PageHeader title="New item" crumbs={[{ label: "Items", href: "/inventory/items" }, { label: "New" }]} />
      <ItemForm id={null} hasMovements={false} {...o} initial={{ itemType: "PRODUCT", inventoryClass: "STOCK", minStockLevel: 0, reorderQty: 0, purchasePrice: 0, sellingPrice: 0, active: true }} />
    </>
  );
}
