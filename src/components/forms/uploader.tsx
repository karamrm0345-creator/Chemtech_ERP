"use client";
import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { uploadAttachmentAction } from "@/app/actions/admin";
import { useAction } from "./use-action";
import { btn } from "@/components/ui/primitives";

const CATEGORIES = ["GENERAL", "SDS", "TDS", "CERTIFICATE", "INSPECTION", "DELIVERY_NOTE", "OFFER", "REGISTRATION", "CORRESPONDENCE"];

export function Uploader({ docType, docId }: { docType: string; docId: string }) {
  const { run, pending } = useAction();
  const [category, setCategory] = useState("GENERAL");
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input w-auto py-1.5 text-xs" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
        {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
      </select>
      <input ref={input} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 10 * 1024 * 1024) { alert("Maximum file size is 10 MB."); return; }
          const fd = new FormData();
          fd.set("file", f); fd.set("docType", docType); fd.set("docId", docId); fd.set("category", category);
          await run(() => uploadAttachmentAction(fd));
          if (input.current) input.current.value = "";
        }} />
      <button type="button" disabled={pending} className={btn("outline", "py-1.5 text-xs")} onClick={() => input.current?.click()}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
      </button>
    </div>
  );
}
