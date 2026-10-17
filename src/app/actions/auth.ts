"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { destroySession, getSessionUser } from "@/server/auth/session";
import { changeOwnPassword, firstRunSetup, login } from "@/server/services/auth";
import { errorMessage } from "@/server/action";

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function loginAction(_: unknown, form: FormData): Promise<{ error?: string }> {
  try {
    await login(String(form.get("email") ?? ""), String(form.get("password") ?? ""), await clientIp());
  } catch (e) {
    return { error: errorMessage(e) };
  }
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function setupAction(_: unknown, form: FormData): Promise<{ error?: string }> {
  try {
    await firstRunSetup(Object.fromEntries(form.entries()));
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect("/admin/users?welcome=1");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function changePasswordAction(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  if (form.get("next") !== form.get("confirm")) return { error: "The new passwords do not match." };
  try {
    await changeOwnPassword(u.userId, String(form.get("current") ?? ""), String(form.get("next") ?? ""));
    return { ok: true };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
