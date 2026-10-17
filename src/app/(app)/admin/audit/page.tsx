import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import type { Prisma } from "@prisma/client";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { dateRange, listArgs, str, type SP } from "@/lib/params";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Audit trail" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser("audit.view");
  const sp = await searchParams;
  const a = listArgs(sp);
  const { from, to } = dateRange(sp);
  const entity = str(sp, "entity");
  const where: Prisma.AuditLogWhereInput = {
    ...(entity ? { entity } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(a.q ? { OR: [{ summary: { contains: a.q, mode: "insensitive" } }, { userName: { contains: a.q, mode: "insensitive" } }, { action: { contains: a.q, mode: "insensitive" } }] } : {}),
  };
  const size = a.pageSize;
  const [rows, total, entities] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (a.page - 1) * size, take: size }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Audit trail" subtitle="Immutable log of important operations: who, what, when, and before/after values." crumbs={[{ label: "Administration" }, { label: "Audit trail" }]}
        actions={<LinkButton variant="outline" href="/reports/audit-trail">Export</LinkButton>} />
      <ListToolbar dateRange placeholder="Search summary, user or action…" filters={[{ name: "entity", label: "Entity", options: entities.map((e) => ({ value: e.entity, label: e.entity })) }]} />
      <DataTable basePath="/admin/audit" sp={sp} total={total} page={a.page} pageSize={size}
        columns={[{ label: "Time" }, { label: "User" }, { label: "Action" }, { label: "Entity" }, { label: "Summary" }, { label: "Changes" }]}
        rows={rows.map((l) => ({ key: l.id, cells: [
          <span key="t" className="whitespace-nowrap text-xs">{fmtDateTime(l.createdAt)}</span>, l.userName ?? "system", <span key="a" className="font-mono text-xs">{l.action}</span>, l.entity, l.summary,
          l.before || l.after ? (
            <details key="d" className="max-w-md text-xs"><summary className="cursor-pointer text-brand-600">view</summary>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-panel p-2">{JSON.stringify({ before: l.before, after: l.after }, null, 1)}</pre>
            </details>
          ) : null,
        ] }))} />
    </>
  );
}
