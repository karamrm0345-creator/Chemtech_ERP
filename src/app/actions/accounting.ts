"use server";
import { runAction } from "@/server/action";
import * as A from "@/server/services/accounting";
import { parseBusinessDate } from "@/lib/format";

const R = ["/accounting", "/finance", "/dashboard"];
const boolField = (v: unknown) => v === true || v === "true" || v === "yes";

export async function createAccountAction(data: Record<string, string>) {
  return runAction(async (u) => ({ id: (await A.createAccount(u, { ...data, isGroup: boolField(data.isGroup), isBank: boolField(data.isBank) })).id }), { revalidate: R, message: "Account created" });
}
export async function updateAccountAction(id: string, data: Record<string, string>) {
  return runAction((u) => A.updateAccount(u, id, { ...data, isGroup: boolField(data.isGroup), isBank: boolField(data.isBank), active: data.active === undefined ? true : boolField(data.active) }), { revalidate: R, message: "Account updated" });
}
export async function setPostingAccountAction(key: string, data: Record<string, string>) {
  return runAction((u) => A.setPostingAccount(u, key, data.accountId), { revalidate: R, message: "Posting account updated" });
}
export async function saveJournalAction(id: string | null, data: unknown) {
  return runAction(async (u) => ({ id: (await A.saveJournal(u, id, data)).id }), { revalidate: R, message: id ? "Journal saved" : "Journal prepared" });
}
export async function postJournalAction(id: string) {
  return runAction((u) => A.postManualJournal(u, id), { revalidate: R, message: "Journal posted" });
}
export async function cancelJournalAction(id: string) {
  return runAction((u) => A.cancelDraftJournal(u, id), { revalidate: R, message: "Journal cancelled" });
}
export async function reverseJournalAction(id: string, reason?: string) {
  return runAction(async (u) => ({ id: (await A.reverseManualJournal(u, id, reason ?? "")).id }), { revalidate: R, message: "Reversing journal posted" });
}
export async function createFiscalYearAction(data: Record<string, string>) {
  return runAction((u) => A.createFiscalYear(u, data), { revalidate: R, message: "Fiscal year created" });
}
export async function closeFiscalYearAction(id: string) {
  return runAction((u) => A.closeFiscalYear(u, id), { revalidate: R, message: "Fiscal year closed" });
}
export async function reopenFiscalYearAction(id: string, reason?: string) {
  return runAction((u) => A.reopenFiscalYear(u, id, reason ?? ""), { revalidate: R, message: "Fiscal year reopened" });
}
export async function setBooksLockAction(data: Record<string, string>) {
  return runAction((u) => A.setBooksLock(u, parseBusinessDate(data.date)), { revalidate: R, message: data.date ? "Books locked" : "Lock date cleared" });
}
