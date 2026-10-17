"use server";
import { runAction } from "@/server/action";
import * as I from "@/server/services/inventory";

const R = ["/inventory", "/dashboard"];

export async function createStockDocAction(data: unknown) {
  return runAction(async (u) => ({ id: (await I.createStockDocument(u, data)).id }), { revalidate: R, message: "Stock document created" });
}
export async function postStockDocAction(id: string) {
  return runAction((u) => I.postStockDocument(u, id), { revalidate: R, message: "Stock document posted" });
}
export async function cancelStockDocAction(id: string) {
  return runAction((u) => I.cancelStockDocument(u, id), { revalidate: R, message: "Stock document cancelled" });
}
export async function reverseStockDocAction(id: string, reason?: string) {
  return runAction((u) => I.reverseStockDocument(u, id, reason ?? ""), { revalidate: R, message: "Reversal posted" });
}
export async function createCountAction(data: unknown) {
  return runAction(async (u) => ({ id: (await I.createStockCount(u, data)).id }), { revalidate: R, message: "Stock count started" });
}
export async function saveCountAction(id: string, entries: { lineId: string; countedQty: string | null }[]) {
  return runAction((u) => I.saveCountQuantities(u, id, entries), { revalidate: R, message: "Counted quantities saved" });
}
export async function postCountAction(id: string) {
  return runAction((u) => I.postStockCount(u, id), { revalidate: R, message: "Count posted" });
}
