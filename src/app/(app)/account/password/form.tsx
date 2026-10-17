"use client";
import { useActionState } from "react";
import { changePasswordAction } from "@/app/actions/auth";
import { btn, Notice } from "@/components/ui/primitives";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, {});
  return (
    <form action={action} className="card space-y-4 p-5">
      <label className="block"><span className="label">Current password</span><input name="current" type="password" required className="input" autoComplete="current-password" /></label>
      <label className="block"><span className="label">New password</span><input name="next" type="password" required minLength={10} className="input" autoComplete="new-password" /></label>
      <label className="block"><span className="label">Confirm new password</span><input name="confirm" type="password" required className="input" autoComplete="new-password" /></label>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.ok && <Notice tone="success">Password changed. Other sessions were signed out.</Notice>}
      <button disabled={pending} className={btn("action")}>Update password</button>
    </form>
  );
}
