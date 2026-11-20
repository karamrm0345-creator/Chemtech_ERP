"use server";
import { runAction } from "@/server/action";
import * as F from "@/server/services/finance";
import * as P from "@/server/services/payments";
import * as N from "@/server/services/returns";

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

// ── Receipts / payments with allocation ──

export async function receiptAction(data: unknown) {
  return runAction(async (u) => ({ id: (await P.recordCustomerPayment(u, data)).id }), { revalidate: R, message: "Receipt recorded" });
}
export async function supplierPaymentEntryAction(data: unknown) {
  return runAction(async (u) => ({ id: (await P.recordSupplierPayment(u, data)).id }), { revalidate: R, message: "Payment recorded" });
}
export async function allocateCustomerCreditAction(source: { paymentId?: string; creditNoteId?: string }, data: Record<string, string>) {
  return runAction((u) => P.allocateCustomerCredit(u, { ...data, ...source }), { revalidate: R, message: "Allocated" });
}
export async function allocateSupplierCreditAction(source: { paymentId?: string; debitNoteId?: string }, data: Record<string, string>) {
  return runAction((u) => P.allocateSupplierCredit(u, { ...data, ...source }), { revalidate: R, message: "Allocated" });
}

// ── Credit / debit notes and customer returns ──
export async function createCreditNoteAction(data: unknown) {
  return runAction(async (u) => ({ id: (await N.createCreditNote(u, data)).id }), { revalidate: R, message: "Credit note prepared" });
}
export async function postCreditNoteAction(id: string) {
  return runAction((u) => N.postCreditNote(u, id), { revalidate: R, message: "Credit note posted" });
}
export async function cancelCreditNoteAction(id: string) {
  return runAction((u) => N.cancelCreditNote(u, id), { revalidate: R, message: "Credit note cancelled" });
}
export async function createDebitNoteAction(data: unknown) {
  return runAction(async (u) => ({ id: (await N.createDebitNote(u, data)).id }), { revalidate: R, message: "Debit note prepared" });
}
export async function postDebitNoteAction(id: string) {
  return runAction((u) => N.postDebitNote(u, id), { revalidate: R, message: "Debit note posted" });
}
export async function cancelDebitNoteAction(id: string) {
  return runAction((u) => N.cancelDebitNote(u, id), { revalidate: R, message: "Debit note cancelled" });
}
export async function createCustomerReturnAction(data: unknown) {
  return runAction(async (u) => ({ id: (await N.createCustomerReturn(u, data)).id }), { revalidate: [...R, "/inventory"], message: "Customer return received" });
}

/** Open invoices of a customer or supplier, oldest due first, for the allocation table. */
export async function openInvoicesAction(side: "customer" | "supplier", partyId: string) {
  return runAction(async (u) => {
    if (!u.permissions.has(side === "customer" ? "finance.sales.manage" : "finance.purchase.manage")) throw new (await import("@/server/errors")).ForbiddenError();
    const rows = side === "customer" ? await P.openSalesInvoices(partyId) : await P.openPurchaseInvoices(partyId);
    return rows.map((i) => ({
      id: i.id, number: i.number, ref: "supplierInvoiceNo" in i ? (i as { supplierInvoiceNo: string }).supplierInvoiceNo : "", date: i.date.toISOString(), dueDate: i.dueDate.toISOString(),
      currency: i.currency, total: i.total.toFixed(2), balance: i.balance.toFixed(2),
    }));
  });
}
