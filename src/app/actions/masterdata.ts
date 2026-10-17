"use server";
import { runAction } from "@/server/action";
import * as C from "@/server/services/customers";
import * as S from "@/server/services/suppliers";
import * as I from "@/server/services/items";

export async function saveCustomerAction(id: string | null, data: unknown, ignoreDuplicates = false) {
  return runAction(async (u) => {
    if (id) return { id: (await C.updateCustomer(u, id, data)).id, duplicates: [] as { code: string; legalName: string }[] };
    const r = await C.createCustomer(u, data, { ignoreDuplicates });
    return { id: r.customer?.id ?? null, duplicates: r.duplicates };
  }, { revalidate: ["/customers"], message: "Customer saved" });
}
export async function addCustomerContactAction(customerId: string, data: unknown) {
  return runAction((u) => C.addCustomerContact(u, customerId, data), { message: "Contact added" });
}
export async function deleteCustomerContactAction(contactId: string) {
  return runAction((u) => C.deleteCustomerContact(u, contactId), { message: "Contact removed" });
}

export async function saveSupplierAction(id: string | null, data: unknown, ignoreDuplicates = false) {
  return runAction(async (u) => {
    if (id) return { id: (await S.updateSupplier(u, id, data)).id, duplicates: [] as { code: string; legalName: string }[] };
    const r = await S.createSupplier(u, data, { ignoreDuplicates });
    return { id: r.supplier?.id ?? null, duplicates: r.duplicates };
  }, { revalidate: ["/suppliers"], message: "Supplier saved" });
}
export async function addSupplierContactAction(supplierId: string, data: unknown) {
  return runAction((u) => S.addSupplierContact(u, supplierId, data), { message: "Contact added" });
}
export async function deleteSupplierContactAction(id: string) {
  return runAction((u) => S.deleteSupplierContact(u, id), { message: "Contact removed" });
}
export async function addSupplierDocumentAction(supplierId: string, data: unknown) {
  return runAction((u) => S.addSupplierDocument(u, supplierId, data), { message: "Document recorded" });
}
export async function deleteSupplierDocumentAction(id: string) {
  return runAction((u) => S.deleteSupplierDocument(u, id), { message: "Document removed" });
}
export async function addSupplierIssueAction(supplierId: string, data: unknown) {
  return runAction((u) => S.addSupplierIssue(u, supplierId, data), { message: "Nonconformity logged" });
}
export async function closeSupplierIssueAction(id: string, resolution?: string) {
  return runAction((u) => S.closeSupplierIssue(u, id, resolution ?? ""), { message: "Issue closed" });
}

export async function saveItemAction(id: string | null, data: unknown) {
  return runAction(async (u) => ({ id: (id ? await I.updateItem(u, id, data) : await I.createItem(u, data)).id }), { revalidate: ["/inventory"], message: "Item saved" });
}
export async function saveMasterAction(kind: "category" | "uom" | "warehouse", id: string | null, data: unknown) {
  return runAction((u) => I.saveMaster(u, kind, id, data), { revalidate: ["/inventory/setup"], message: "Saved" });
}
export async function saveLocationAction(warehouseId: string, id: string | null, data: unknown) {
  return runAction((u) => I.saveLocation(u, warehouseId, id, data), { revalidate: ["/inventory/setup"], message: "Location saved" });
}
