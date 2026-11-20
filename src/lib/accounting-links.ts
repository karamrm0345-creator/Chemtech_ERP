/** Page of the document that posted a journal, when it has one. */
export function sourceHref(sourceType: string | null, sourceId: string | null): string | null {
  if (!sourceType || !sourceId) return null;
  const base: Record<string, string> = {
    SalesInvoice: "/finance/sales-invoices", PurchaseInvoice: "/finance/purchase-invoices", GoodsReceipt: "/purchasing/receipts",
    DeliveryOrder: "/sales/deliveries", StockDocument: "/inventory/documents", StockCount: "/inventory/counts", PurchaseReturn: "/purchasing/returns",
  };
  if (sourceType === "FiscalYear") return "/accounting/fiscal-years";
  return base[sourceType] ? `${base[sourceType]}/${sourceId}` : null;
}

export const JOURNAL_TYPES = [
  "MANUAL", "OPENING", "SALES_INVOICE", "CUSTOMER_PAYMENT", "PURCHASE_INVOICE", "SUPPLIER_PAYMENT", "STOCK", "CLOSING",
] as const;
