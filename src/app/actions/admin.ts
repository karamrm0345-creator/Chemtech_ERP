"use server";
import { runAction } from "@/server/action";
import * as A from "@/server/services/admin";
import { deleteAttachment, saveAttachment } from "@/server/services/attachments";

export async function saveUserAction(id: string | null, data: unknown) {
  return runAction(async (u) => ({ id: (await A.saveUser(u, id, data)).id }), { revalidate: ["/admin"], message: "User saved" });
}
export async function saveRoleAction(id: string | null, data: unknown) {
  return runAction(async (u) => ({ id: (await A.saveRole(u, id, data)).id }), { revalidate: ["/admin"], message: "Role saved" });
}
export async function saveSettingsAction(data: unknown) {
  return runAction((u) => A.saveSettings(u, data), { revalidate: ["/"], message: "Settings saved" });
}
export async function saveSequenceAction(docType: string, data: unknown) {
  return runAction((u) => A.saveSequence(u, docType, data), { revalidate: ["/admin"], message: "Numbering saved" });
}
export async function saveCurrencyAction(data: unknown) {
  return runAction((u) => A.saveCurrency(u, data), { revalidate: ["/admin"], message: "Currency saved" });
}
export async function saveCriterionAction(id: string | null, data: unknown) {
  return runAction((u) => A.saveCriterion(u, id, data), { revalidate: ["/admin"], message: "Criterion saved" });
}
export async function uploadAttachmentAction(form: FormData) {
  return runAction(async (u) => {
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file");
    const a = await saveAttachment(u, String(form.get("docType")), String(form.get("docId")), file, String(form.get("category") ?? "GENERAL"));
    return { id: a.id };
  }, { message: "File uploaded" });
}
export async function deleteAttachmentAction(id: string) {
  return runAction((u) => deleteAttachment(u, id), { message: "Attachment deleted" });
}
export async function uploadLogoAction(form: FormData) {
  return runAction(async (u) => {
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file");
    const { saveCompanyLogo } = await import("@/server/services/attachments");
    await saveCompanyLogo(u, file);
  }, { revalidate: ["/"], message: "Logo updated" });
}
export async function resetLogoAction() {
  return runAction(async (u) => {
    const { clearCompanyLogo } = await import("@/server/services/attachments");
    await clearCompanyLogo(u);
  }, { revalidate: ["/"], message: "Logo reset to default" });
}
