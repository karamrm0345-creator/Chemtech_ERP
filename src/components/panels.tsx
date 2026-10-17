import { FileText, Download } from "lucide-react";
import { prisma } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { listAttachments, DOC_VIEW_PERMISSION } from "@/server/services/attachments";
import { Card, StatusBadge } from "./ui/primitives";
import { Uploader } from "./forms/uploader";
import { ActionButton } from "./forms/action-button";
import { deleteAttachmentAction } from "@/app/actions/admin";
import { fmtDateTime, humanize } from "@/lib/format";

export async function AttachmentsPanel({ user, docType, docId, title = "Attachments" }: { user: SessionUser; docType: string; docId: string; title?: string }) {
  const perm = DOC_VIEW_PERMISSION[docType];
  if (!perm || !user.permissions.has(perm)) return null;
  const files = await listAttachments(docType, docId);
  return (
    <Card title={title} actions={user.permissions.has("attachment.upload") ? <Uploader docType={docType} docId={docId} /> : undefined}>
      {files.length === 0 ? <p className="text-sm text-ink-muted">No documents attached.</p> : (
        <ul className="divide-y divide-line">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-ink-muted" />
                <a href={`/api/attachments/${f.id}`} className="link truncate">{f.fileName}</a>
                <span className="rounded bg-panel px-1.5 text-[10px] font-semibold text-ink-soft">{humanize(f.category)}</span>
              </span>
              <span className="flex items-center gap-3 text-xs text-ink-muted">
                {(f.size / 1024).toFixed(0)} KB · {fmtDateTime(f.createdAt)}
                <a href={`/api/attachments/${f.id}?download=1`} aria-label="Download"><Download className="h-4 w-4 hover:text-ink" /></a>
                {user.permissions.has("attachment.delete") && <ActionButton variant="ghost" label="Delete" confirm={`Delete ${f.fileName}?`} action={deleteAttachmentAction.bind(null, f.id)} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export async function HistoryPanel({ entity, entityId, docType }: { entity: string; entityId: string; docType?: string }) {
  const [logs, approvals] = await Promise.all([
    prisma.auditLog.findMany({ where: { entity, entityId }, orderBy: { createdAt: "desc" }, take: 50 }),
    docType ? prisma.approvalRecord.findMany({ where: { docType, docId: entityId }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
  ]);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: approvals.map((a) => a.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <Card title="History">
      {approvals.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-bold uppercase text-ink-muted">Workflow</p>
          <ol className="space-y-2">
            {approvals.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={a.action === "APPROVE" ? "APPROVED" : a.action === "REJECT" || a.action === "CANCEL" ? "REJECTED" : "SUBMITTED"} label={humanize(a.action)} />
                <span className="font-medium">{users.get(a.userId) ?? "—"}</span>
                <span className="text-xs text-ink-muted">{fmtDateTime(a.createdAt)}</span>
                {a.comment && <span className="w-full pl-1 text-xs italic text-ink-soft">“{a.comment}”</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="mb-2 text-xs font-bold uppercase text-ink-muted">Audit log</p>
      {logs.length === 0 ? <p className="text-sm text-ink-muted">No entries.</p> : (
        <ol className="space-y-1.5 text-sm">
          {logs.map((l) => (
            <li key={l.id} className="flex gap-2">
              <span className="w-36 shrink-0 text-xs text-ink-muted">{fmtDateTime(l.createdAt)}</span>
              <span><span className="font-medium">{l.userName ?? "system"}</span> · {l.summary ?? l.action}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
