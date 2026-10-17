"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}
      className={`w-[calc(100vw-2rem)] ${wide ? "max-w-3xl" : "max-w-md"} rounded-lg border border-line p-0 shadow-xl backdrop:bg-ink/40`}>
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="font-semibold">{title}</h3>
            <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
