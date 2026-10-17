"use server";
import { runAction } from "@/server/action";
import * as F from "@/server/services/finance";

const R = ["/finance", "/dashboard", "/sales", "/purchasing", "/customers", "/suppliers"];

export async function createSalesInvoiceAction(data: unknown) {
  return runAction(async (u) => ({ id: (await F.createSalesInvoice(u, data)).id }), { revalidate: R, message: "Invoice created" });
}
export async function postSalesInvoiceAction(id: string) {
  return runAction((u) => F.postSalesInvoice(u, id), { revalidate: R, message: "Invoice posted" });
}
export async function cancelSalesInvoiceAction(id: string) {
  return runAction((u) => F.cancelSalesInvoice(u, id), { revalidate: R, message: "Invoice cancelled" });
}
export async function customerPaymentAction(data: unknown) {
  return runAction((u) => F.recordCustomerPayment(u, data), { revalidate: R, message: "Receipt recorded" });
}
export async function createPurchaseInvoiceAction(data: unknown) {
  return runAction(async (u) => ({ id: (await F.createPurchaseInvoice(u, data)).id }), { revalidate: R, message: "Supplier invoice recorded" });
}
export async function postPurchaseInvoiceAction(id: string, varianceJustification?: string) {
  return runAction((u) => F.postPurchaseInvoice(u, id, varianceJustification), { revalidate: R, message: "Supplier invoice posted" });
}
export async function supplierPaymentAction(data: unknown) {
  return runAction((u) => F.recordSupplierPayment(u, data), { revalidate: R, message: "Payment recorded" });
}
export async function customerPaymentForInvoiceAction(invoiceId: string, data: Record<string, string>) {
  return customerPaymentAction({ ...data, invoiceId });
}
export async function supplierPaymentForInvoiceAction(invoiceId: string, data: Record<string, string>) {
  return supplierPaymentAction({ ...data, invoiceId });
}
