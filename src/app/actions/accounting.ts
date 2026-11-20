"use server";
import { runAction } from "@/server/action";
import * as A from "@/server/services/accounting";
import * as FA from "@/server/services/fixed-assets";
import * as BU from "@/server/services/budgets";
import * as BK from "@/server/services/bank";
import * as PE from "@/server/services/period-end";
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
export async function saveCostCenterAction(id: string | null, data: Record<string, string>) {
  return runAction((u) => A.saveCostCenter(u, id, { ...data, active: data.active === undefined ? true : boolField(data.active) }), { revalidate: R, message: "Cost centre saved" });
}
export async function saveTaxCodeAction(id: string | null, data: Record<string, string>) {
  return runAction((u) => A.saveTaxCode(u, id, { ...data, active: data.active === undefined ? true : boolField(data.active) }), { revalidate: R, message: "Tax code saved" });
}

// ── Phase 3: fixed assets, budgets, bank reconciliation, revaluation ──

export async function saveAssetAction(id: string | null, data: Record<string, string>) {
  return runAction(async (u) => ({ id: (await FA.saveAsset(u, id, data)).id }), { revalidate: R, message: id ? "Asset updated" : "Asset registered" });
}
export async function capitaliseAssetAction(id: string, data: Record<string, string>) {
  return runAction((u) => FA.capitaliseAsset(u, id, data.fundingAccountId), { revalidate: R, message: "Asset capitalised" });
}
export async function runDepreciationAction(data: Record<string, string>) {
  return runAction(async (u) => {
    const r = await FA.runDepreciation(u, parseBusinessDate(data.date) ?? new Date());
    return { assets: r.assets, total: r.total.toFixed(2) };
  }, { revalidate: R, message: "Depreciation run complete" });
}
export async function disposeAssetAction(id: string, data: Record<string, string>) {
  return runAction((u) => FA.disposeAsset(u, id, data).then(() => undefined), { revalidate: R, message: "Asset disposed" });
}
export async function saveAssetCategoryAction(id: string | null, data: Record<string, string>) {
  return runAction((u) => FA.saveAssetCategory(u, id, data).then(() => undefined), { revalidate: R, message: "Category saved" });
}
export async function saveBudgetAction(id: string | null, data: unknown) {
  return runAction(async (u) => ({ id: (await BU.saveBudget(u, id, data)).id }), { revalidate: R, message: "Budget saved" });
}
export async function importStatementAction(data: unknown) {
  return runAction(async (u) => ({ id: (await BK.importStatement(u, data)).id }), { revalidate: R, message: "Statement imported" });
}
export async function autoMatchAction(statementId: string) {
  return runAction(async (u) => { const r = await BK.autoMatch(u, statementId); return r; }, { revalidate: R, message: "Matching complete" });
}
export async function matchLineAction(lineId: string, data: Record<string, string>) {
  return runAction((u) => BK.matchLine(u, lineId, data.journalLineId), { revalidate: R, message: "Matched" });
}
export async function unmatchLineAction(lineId: string) {
  return runAction((u) => BK.unmatchLine(u, lineId), { revalidate: R, message: "Unmatched" });
}
export async function bookStatementLineAction(lineId: string, data: Record<string, string>) {
  return runAction((u) => BK.bookStatementLine(u, lineId, data).then(() => undefined), { revalidate: R, message: "Booked and matched" });
}
export async function deleteStatementAction(statementId: string) {
  return runAction((u) => BK.deleteStatement(u, statementId), { revalidate: R, message: "Statement deleted" });
}
export async function completeReconciliationAction(statementId: string) {
  return runAction((u) => BK.completeReconciliation(u, statementId), { revalidate: R, message: "Reconciliation completed" });
}
export async function postRevaluationAction(data: unknown) {
  return runAction(async (u) => { const r = await PE.postRevaluation(u, data); return { journalId: r.journalId }; }, { revalidate: R, message: "Revaluation posted" });
}
