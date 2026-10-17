"use client";
import { useActionState, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { loginAction } from "@/app/actions/auth";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, {});
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <input name="email" type="email" required autoComplete="username" placeholder="Email address *" aria-label="Email address" className="input input-lg" autoFocus />
      <div className="relative">
        <input name="password" type={show ? "text" : "password"} required autoComplete="current-password" placeholder="Password *" aria-label="Password" className="input input-lg pr-11" />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
          {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      {state?.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="flex w-full items-center justify-center gap-2 rounded-md bg-action-500 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-action-600 disabled:opacity-70">
        {pending && <Loader2 className="h-5 w-5 animate-spin" />} Sign in
      </button>
      <p className="text-center text-xs text-ink-muted">Accounts are created by your system administrator. Contact them if you need access or a password reset.</p>
    </form>
  );
}
