"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveItemAction } from "@/app/actions/masterdata";
import { useAction } from "@/components/forms/use-action";
import { Field, Select, Check, FormActions, bind } from "@/components/forms/fields";
import { EntityPicker } from "@/components/forms/entity-picker";
import { btn, Card, Notice } from "@/components/ui/primitives";
import { ITEM_TYPES, INVENTORY_CLASS_LABEL, opts } from "@/lib/options";

type Opt = { value: string; label: string };

export function ItemForm({ id, initial, categories, uoms, warehouses, locations, supplierLabel, hasMovements }: {
  id: string | null; initial: Record<string, unknown>; categories: Opt[]; uoms: Opt[]; warehouses: Opt[];
  locations: (Opt & { warehouseId: string })[]; supplierLabel?: string; hasMovements: boolean;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [s, setS] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initial).filter(([, v]) => typeof v !== "boolean").map(([k, v]) => [k, v == null ? "" : String(v)])));
  const [f, setF] = useState({
    batchTracked: !!initial.batchTracked, serialTracked: !!initial.serialTracked, expiryTracked: !!initial.expiryTracked,
    hazardous: !!initial.hazardous, active: initial.active !== false,
  });
  const b = (k: string) => bind(s, setS, k);
  const isService = s.itemType === "SERVICE" || s.inventoryClass === "NON_STOCK";
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      await run(() => saveItemAction(id, { ...s, ...f }), { redirect: (d) => `/inventory/items/${(d as { id: string }).id}` });
    }}>
      {hasMovements && <Notice tone="info">Stock movements exist for this item, so its code, unit of measure and tracking settings are locked to protect stock history.</Notice>}
      <Card title="Identification">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Item code" required><input className="input font-mono uppercase" required disabled={hasMovements} {...b("code")} /></Field>
          <Field label="Description" required className="sm:col-span-2 lg:col-span-3"><input className="input" required {...b("name")} /></Field>
          <Field label="Item type" required><Select value={s.itemType || "PRODUCT"} onChange={(v) => setS({ ...s, itemType: v, inventoryClass: v === "SERVICE" ? "NON_STOCK" : s.inventoryClass === "NON_STOCK" ? "STOCK" : s.inventoryClass })} options={opts(ITEM_TYPES)} /></Field>
          <Field label="Inventory control" hint="Distinguishes consumables, serialized assets and rental equipment">
            <Select value={s.inventoryClass || "STOCK"} disabled={hasMovements || s.itemType === "SERVICE"} onChange={(v) => setS({ ...s, inventoryClass: v })} options={Object.entries(INVENTORY_CLASS_LABEL).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Category"><Select value={s.categoryId ?? ""} onChange={(v) => setS({ ...s, categoryId: v })} options={categories} placeholder="—" /></Field>
          <Field label="Unit of measure" required><Select required disabled={hasMovements} value={s.uomId ?? ""} onChange={(v) => setS({ ...s, uomId: v })} options={uoms} placeholder="Select" /></Field>
          <Field label="Manufacturer"><input className="input" {...b("manufacturer")} /></Field>
          <Field label="Manufacturer part no."><input className="input" {...b("manufacturerPartNo")} /></Field>
          <Field label="Supplier part no."><input className="input" {...b("supplierPartNo")} /></Field>
          <Field label="Preferred supplier"><EntityPicker entity="suppliers" value={s.preferredSupplierId || null} initialLabel={supplierLabel} onChange={(o) => setS({ ...s, preferredSupplierId: o?.id ?? "" })} /></Field>
          <Field label="Technical description" className="sm:col-span-2 lg:col-span-4"><textarea className="input" rows={2} {...b("description")} /></Field>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Pricing (base currency)">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Standard purchase price"><input className="input" inputMode="decimal" {...b("purchasePrice")} /></Field>
            <Field label="Selling price"><input className="input" inputMode="decimal" {...b("sellingPrice")} /></Field>
          </div>
          <p className="mt-2 text-xs text-ink-muted">Stock is valued at moving weighted-average cost, updated automatically from goods receipts (incl. freight).</p>
        </Card>
        <Card title="Stock control">
          {isService ? <p className="text-sm text-ink-muted">Service / non-stock items do not create stock movements.</p> : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum stock (reorder level)"><input className="input" inputMode="decimal" {...b("minStockLevel")} /></Field>
              <Field label="Reorder quantity"><input className="input" inputMode="decimal" {...b("reorderQty")} /></Field>
              <Field label="Default warehouse"><Select value={s.defaultWarehouseId ?? ""} onChange={(v) => setS({ ...s, defaultWarehouseId: v, defaultLocationId: "" })} options={warehouses} placeholder="—" /></Field>
              <Field label="Bin location"><Select value={s.defaultLocationId ?? ""} onChange={(v) => setS({ ...s, defaultLocationId: v })} options={locations.filter((l) => l.warehouseId === s.defaultWarehouseId)} placeholder="—" /></Field>
              <div className="sm:col-span-2">
                <Check label="Batch / lot tracking" checked={f.batchTracked || f.expiryTracked} onChange={(v) => setF({ ...f, batchTracked: v })} hint={hasMovements ? "Locked" : undefined} />
                <Check label="Expiry date required (chemicals)" checked={f.expiryTracked} onChange={(v) => setF({ ...f, expiryTracked: v, batchTracked: v || f.batchTracked })} />
                <Check label="Serial number tracking" checked={f.serialTracked || s.inventoryClass === "SERIALIZED_ASSET" || s.inventoryClass === "RENTAL"} onChange={(v) => setF({ ...f, serialTracked: v })} hint="Always on for serialized assets and rental equipment" />
                <Check label="Hazardous material (SDS required)" checked={f.hazardous} onChange={(v) => setF({ ...f, hazardous: v })} />
              </div>
            </div>
          )}
          <div className="mt-2 border-t border-line pt-2"><Check label="Active" checked={f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
        </Card>
      </div>
      <FormActions>
        <button type="button" className={btn("outline")} onClick={() => router.back()}>Cancel</button>
        <button className={btn("action")} disabled={pending}>Save item</button>
      </FormActions>
    </form>
  );
}
