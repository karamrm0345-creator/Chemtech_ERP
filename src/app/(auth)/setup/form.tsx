"use client";
import { useActionState, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { setupAction } from "@/app/actions/auth";

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, {});
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-3.5">
      <input name="companyName" required placeholder="Company / trade name *" aria-label="Company name" className="input input-lg" defaultValue="Chemtech" />
      <input name="name" required placeholder="Administrator full name *" aria-label="Administrator name" className="input input-lg" />
      <input name="email" type="email" required placeholder="Email address *" aria-label="Email" className="input input-lg" autoComplete="username" />
      <div className="flex">
        <span className="flex items-center gap-1.5 rounded-l-md border border-r-0 border-line bg-white px-3 text-sm font-semibold">
          <span aria-hidden className="inline-block h-3 w-4 rounded-sm bg-[#8a1538]" /> +974
        </span>
        <input name="phone" type="tel" placeholder="Mobile number" aria-label="Mobile number" className="input input-lg rounded-l-none" />
      </div>
      <div className="relative">
        <input name="password" type={show ? "text" : "password"} required minLength={10} placeholder="Password * (min 10, letters & numbers)" aria-label="Password" className="input input-lg pr-11" autoComplete="new-password" />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-label="Toggle password visibility">
          {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      {state?.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="flex w-full items-center justify-center gap-2 rounded-md bg-action-500 py-3.5 text-base font-bold text-white hover:bg-action-600 disabled:opacity-70">
        {pending && <Loader2 className="h-5 w-5 animate-spin" />} Create company & administrator
      </button>
    </form>
  );
}
