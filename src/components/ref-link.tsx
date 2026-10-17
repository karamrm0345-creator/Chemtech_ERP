import Link from "next/link";

const REF_PATH: Record<string, string> = {
  StockDocument: "/inventory/documents", StockCount: "/inventory/counts", DeliveryOrder: "/sales/deliveries",
  GoodsReceipt: "/purchasing/receipts", PurchaseReturn: "/purchasing/returns",
};

/** Link from a ledger row to its source document. */
export function RefLink({ type, id, no }: { type: string; id: string; no: string }) {
  const p = REF_PATH[type];
  return p ? <Link href={`${p}/${id}`} className="link text-xs">{no}</Link> : <span className="text-xs">{no}</span>;
}
