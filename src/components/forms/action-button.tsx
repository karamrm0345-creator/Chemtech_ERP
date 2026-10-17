"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { btn } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { useAction, type Result } from "./use-action";

/**
 * Button for a state-changing server action. Optional confirmation dialog
 * and optional comment prompt (e.g. rejection reason).
 */
export function ActionButton({
  action, label, variant = "outline", confirm, prompt, promptRequired, success, redirectTo, redirectBase, icon,
}: {
  action: (comment?: string) => Promise<Result<unknown>>;
  label: string;
  variant?: "primary" | "action" | "outline" | "ghost" | "danger";
  confirm?: string;
  prompt?: string;
  promptRequired?: boolean;
  success?: string;
  redirectTo?: string | ((data: unknown) => string | undefined);
  /** Navigate to `${redirectBase}/${data.id}` on success (serializable alternative to a callback). */
  redirectBase?: string;
  icon?: React.ReactNode;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const go = async () => {
    const r = await run(() => action(comment || undefined), {
      success,
      redirect: redirectBase ? (d) => ((d as { id?: string })?.id ? `${redirectBase}/${(d as { id: string }).id}` : undefined)
        : typeof redirectTo === "function" ? redirectTo : redirectTo ? () => redirectTo : undefined,
    });
    if (r) { setOpen(false); setComment(""); }
  };
  return (
    <>
      <button type="button" disabled={pending} className={btn(variant)} onClick={() => (confirm || prompt ? setOpen(true) : go())}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        {label}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={label}>
        {confirm && <p className="mb-3 text-sm text-ink-soft">{confirm}</p>}
        {prompt && (
          <label className="block">
            <span className="label">{prompt}{promptRequired && " *"}</span>
            <textarea className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus maxLength={1000} />
          </label>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btn("outline")} onClick={() => setOpen(false)}>Back</button>
          <button type="button" className={btn(variant === "outline" || variant === "ghost" ? "primary" : variant)} disabled={pending || (promptRequired && !comment.trim())} onClick={go}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Confirm
          </button>
        </div>
      </Dialog>
    </>
  );
}
