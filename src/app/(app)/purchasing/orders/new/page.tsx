import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { salesFormOptions, toDateInput } from "../../../sales/data";
import type { LineState } from "@/components/forms/line-items";
import { PoForm, type PoInitial } from "../po-form";

export const metadata = { title: "New purchase order" };

export default async function Page({ searchParams }: { searchParams: Promise<{ supplierId?: string; purchaseRequestId?: string; supplierQuotationId?: string }> }) {
  await requireUser("purchase.order.manage");
  const sp = await searchParams;
  const o = await salesFormOptions();
  const init: PoInitial = { supplierId: null, date: toDateInput(new Date()), warehouseId: o.warehouses[0]?.value ?? "", currency: "QAR", allowPartial: true, freight: "0", otherCharges: "0", lines: [] };
  const label = async (ids: (string | null)[]) => new Map((await prisma.item.findMany({ where: { id: { in: ids.filter(Boolean) as string[] } } })).map((i) => [i.id, `${i.code} — ${i.name}`]));

  if (sp.supplierQuotationId) {
    const q = await prisma.supplierQuotation.findUnique({ where: { id: sp.supplierQuotationId }, include: { supplier: true, lines: { orderBy: { lineNo: "asc" } }, rfq: { include: { lines: true } } } });
    if (q) {
      const names = await label(q.lines.map((l) => l.itemId));
      Object.assign(init, {
        supplierId: q.supplierId, supplierLabel: q.supplier.legalName, supplierQuotationId: q.id, supplierQuotationNo: q.number, supplierQuoteRef: q.supplierRef ?? "",
        purchaseRequestId: q.rfq?.purchaseRequestId ?? undefined, currency: q.currency, paymentTerms: q.paymentTerms ?? "", deliveryTerms: q.deliveryTerms ?? "",
        expectedDate: q.deliveryDays != null ? toDateInput(new Date(Date.now() + q.deliveryDays * 86_400_000)) : "",
        lines: q.lines.map((l): LineState => ({ key: l.id, itemId: l.itemId, itemLabel: l.itemId ? names.get(l.itemId) : undefined, description: l.description, quantity: l.quantity.toString(), uom: l.uom ?? "", unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), taxRate: l.taxRate.toString(), prLineId: q.rfq?.lines.find((r) => r.id === l.rfqLineId)?.prLineId ?? null })),
      });
      if (init.purchaseRequestId) init.purchaseRequestNo = (await prisma.purchaseRequest.findUnique({ where: { id: init.purchaseRequestId } }))?.number;
    }
  } else if (sp.purchaseRequestId) {
    const pr = await prisma.purchaseRequest.findUnique({ where: { id: sp.purchaseRequestId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    if (pr) {
      const names = await label(pr.lines.map((l) => l.itemId));
      Object.assign(init, {
        purchaseRequestId: pr.id, purchaseRequestNo: pr.number, expectedDate: toDateInput(pr.requiredDate),
        lines: pr.lines.filter((l) => l.quantity.gt(l.orderedQty)).map((l): LineState => ({ key: l.id, itemId: l.itemId, itemLabel: l.itemId ? names.get(l.itemId) : undefined, description: l.description, quantity: l.quantity.sub(l.orderedQty).toString(), uom: l.uom ?? "", unitPrice: l.estimatedUnitPrice.toString(), discountPct: "0", taxRate: o.defaultTax, prLineId: l.id })),
      });
    }
  }
  if (sp.supplierId && !init.supplierId) {
    const s = await prisma.supplier.findUnique({ where: { id: sp.supplierId } });
    if (s) Object.assign(init, { supplierId: s.id, supplierLabel: s.legalName, currency: s.currency, paymentTerms: s.paymentTerms ?? "" });
  }
  return (
    <>
      <PageHeader title="New purchase order" crumbs={[{ label: "Procurement" }, { label: "Purchase orders", href: "/purchasing/orders" }, { label: "New" }]} />
      <PoForm id={null} initial={init} currencies={o.currencies} warehouses={o.warehouses} defaultTax={o.defaultTax} />
    </>
  );
}
