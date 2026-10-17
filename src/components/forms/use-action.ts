"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

export type Result<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** Calls a server action with pending state, toasts and navigation/refresh. */
export function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  async function run<T>(fn: () => Promise<Result<T>>, opts: { success?: string; redirect?: (data: T | undefined) => string | undefined; refresh?: boolean } = {}) {
    if (pending) return null; // guards double-clicks / duplicate submissions
    setPending(true);
    try {
      const r = await fn();
      if (!r.ok) { toast("error", r.error); return null; }
      toast("success", r.message ?? opts.success ?? "Saved");
      const to = opts.redirect?.(r.data);
      if (to) router.push(to);
      else if (opts.refresh !== false) router.refresh();
      return r;
    } catch {
      toast("error", "Network or server error. Please try again.");
      return null;
    } finally {
      setPending(false);
    }
  }
  return { run, pending };
}
