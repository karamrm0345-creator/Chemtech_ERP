"use server";
import { runAction } from "@/server/action";
import * as P from "@/server/services/purchasing";

const R = ["/purchasing", "/dashboard", "/suppliers", "/inventory"];

export async function savePrAction(id: string | null, data: unknown) {
  return runAction(async (u) => ({ id: (await P.savePurchaseRequest(u, id, data)).id }), { revalidate: R, message: "Purchase request saved" });
}
export async function prActionAction(id: string, action: Parameters<typeof P.purchaseRequestAction>[2], comment?: string) {
  return runAction((u) => P.purchaseRequestAction(u, id, action, comment), { revalidate: R, message: "Purchase request updated" });
}
export async function lowStockPrAction(itemIds: string[]) {
  return runAction(async (u) => ({ id: (await P.purchaseRequestFromLowStock(u, itemIds)).id }), { revalidate: R, message: "Purchase request created from low stock" });
}
export async function createRfqAction(data: unknown) {
  return runAction(async (u) => ({ id: (await P.createRfq(u, data)).id }), { revalidate: R, message: "RFQ created" });
}
export async function rfqActionAction(id: string, action: "send" | "close" | "cancel") {
  return runAction((u) => P.rfqAction(u, id, action), { revalidate: R, message: "RFQ updated" });
}
export async function saveSupplierQuoteAction(id: string | null, data: unknown) {
  return runAction(async (u) => ({ id: (await P.saveSupplierQuotation(u, id, data)).id }), { revalidate: R, message: "Supplier quotation saved" });
}
export async function selectQuoteAction(id: string, comment?: string) {
  return runAction((u) => P.selectSupplierQuotation(u, id, comment), { revalidate: R, message: "Supplier quotation selected" });
}
export async function savePoAction(id: string | null, data: unknown) {
  return runAction(async (u) => ({ id: (await P.savePurchaseOrder(u, id, data)).id }), { revalidate: R, message: "Purchase order saved" });
}
export async function poActionAction(id: string, action: Parameters<typeof P.purchaseOrderAction>[2], comment?: string) {
  return runAction((u) => P.purchaseOrderAction(u, id, action, comment), { revalidate: R, message: "Purchase order updated" });
}
export async function createGrnAction(data: unknown) {
  return runAction(async (u) => ({ id: (await P.createGoodsReceipt(u, data)).id }), { revalidate: R, message: "Goods receipt created" });
}
export async function postGrnAction(id: string) {
  return runAction((u) => P.postGoodsReceipt(u, id), { revalidate: R, message: "Goods receipt posted — stock received" });
}
export async function cancelGrnAction(id: string) {
  return runAction((u) => P.cancelGoodsReceipt(u, id), { revalidate: R, message: "Goods receipt cancelled" });
}
export async function purchaseReturnAction(data: unknown) {
  return runAction(async (u) => ({ id: (await P.createAndPostPurchaseReturn(u, data)).id }), { revalidate: R, message: "Return to supplier posted" });
}
