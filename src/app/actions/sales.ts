"use server";
import { runAction } from "@/server/action";
import * as S from "@/server/services/sales";

const R = ["/sales", "/dashboard", "/customers", "/inventory"];

export async function saveQuotationAction(id: string | null, data: unknown) {
  return runAction(async (u) => ({ id: (await S.saveQuotation(u, id, data)).id }), { revalidate: R, message: "Quotation saved" });
}
export async function quotationActionAction(id: string, action: Parameters<typeof S.quotationAction>[2], comment?: string) {
  return runAction((u) => S.quotationAction(u, id, action, comment), { revalidate: R, message: "Quotation updated" });
}
export async function reviseQuotationAction(id: string) {
  return runAction(async (u) => ({ id: (await S.reviseQuotation(u, id)).id }), { revalidate: R, message: "Revision created" });
}
export async function convertQuotationAction(id: string, warehouseId: string) {
  return runAction(async (u) => ({ id: (await S.convertQuotationToOrder(u, id, warehouseId)).id }), { revalidate: R, message: "Sales order created" });
}
export async function convertQuotationFormAction(id: string, data: Record<string, string>) {
  return convertQuotationAction(id, data.warehouseId ?? "");
}
export async function saveSalesOrderAction(id: string | null, data: unknown) {
  return runAction(async (u) => ({ id: (await S.saveSalesOrder(u, id, data)).id }), { revalidate: R, message: "Sales order saved" });
}
export async function salesOrderActionAction(id: string, action: Parameters<typeof S.salesOrderAction>[2], comment?: string) {
  return runAction((u) => S.salesOrderAction(u, id, action, comment), { revalidate: R, message: "Sales order updated" });
}
export async function reserveAction(id: string) {
  return runAction(async (u) => {
    const r = await S.reserveOrderStock(u, id);
    return r;
  }, { revalidate: R, message: "Stock reservation updated" });
}
export async function releaseAction(id: string) {
  return runAction((u) => S.releaseOrderReservations(u, id), { revalidate: R, message: "Reservations released" });
}
export async function shortagePrAction(id: string) {
  return runAction(async (u) => ({ id: (await S.purchaseRequestFromShortage(u, id)).id }), { revalidate: ["/purchasing"], message: "Purchase request created" });
}
export async function createDeliveryAction(data: unknown) {
  return runAction(async (u) => ({ id: (await S.createDelivery(u, data)).id }), { revalidate: R, message: "Delivery order created" });
}
export async function postDeliveryAction(id: string) {
  return runAction((u) => S.postDelivery(u, id), { revalidate: R, message: "Delivery posted — stock issued" });
}
export async function cancelDeliveryAction(id: string) {
  return runAction((u) => S.cancelDelivery(u, id), { revalidate: R, message: "Delivery cancelled" });
}
