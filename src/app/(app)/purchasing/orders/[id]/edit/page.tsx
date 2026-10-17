import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { salesFormOptions, toLineStates, toDateInput } from "../../../../sales/data";
import { PoForm } from "../../po-form";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("purchase.order.manage");
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, lines: { orderBy: { lineNo: "asc" } }, supplierQuotation: true, purchaseRequest: true } });
  if (!po) notFound();
  if (!["DRAFT", "REJECTED"].includes(po.status)) redirect(`/purchasing/orders/${id}`);
  const o = await salesFormOptions();
  const lines = (await toLineStates(po.lines)).map((l, i) => ({ ...l, prLineId: po.lines[i].prLineId }));
  return (
    <>
      <PageHeader title={`Edit ${po.number}`} crumbs={[{ label: "Purchase orders", href: "/purchasing/orders" }, { label: po.number, href: `/purchasing/orders/${id}` }, { label: "Edit" }]} />
      <PoForm id={id} currencies={o.currencies} warehouses={o.warehouses} defaultTax={o.defaultTax} initial={{
        supplierId: po.supplierId, supplierLabel: po.supplier.legalName, supplierQuotationId: po.supplierQuotationId ?? undefined, supplierQuotationNo: po.supplierQuotation?.number,
        purchaseRequestId: po.purchaseRequestId ?? undefined, purchaseRequestNo: po.purchaseRequest?.number, supplierQuoteRef: po.supplierQuoteRef ?? "", date: toDateInput(po.date),
        expectedDate: toDateInput(po.expectedDate), warehouseId: po.warehouseId, currency: po.currency, paymentTerms: po.paymentTerms ?? "", deliveryTerms: po.deliveryTerms ?? "",
        allowPartial: po.allowPartial, freight: po.freight.toString(), otherCharges: po.otherCharges.toString(), notes: po.notes ?? "", lines,
      }} />
    </>
  );
}
