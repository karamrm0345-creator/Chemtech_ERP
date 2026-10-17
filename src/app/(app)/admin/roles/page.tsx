import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, LinkButton, Badge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  await requireUser("admin.roles");
  const roles = await prisma.role.findMany({ include: { _count: { select: { users: true, permissions: true } } }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="Permissions are enforced on the server for every action. Approval limits cap the value each role may approve."
        crumbs={[{ label: "Administration" }, { label: "Roles" }]} actions={<LinkButton href="/admin/roles/new" variant="action"><Plus className="h-4 w-4" /> New role</LinkButton>} />
      <DataTable basePath="/admin/roles" columns={[{ label: "Role" }, { label: "Code" }, { label: "Description" }, { label: "Permissions", align: "right" }, { label: "Users", align: "right" }]}
        rows={roles.map((r) => ({ key: r.id, cells: [
          <Link key="n" href={`/admin/roles/${r.id}`} className="link">{r.name}</Link>, <span key="c" className="font-mono text-xs">{r.code} {r.isSystem && <Badge>system</Badge>}</span>,
          r.description, r._count.permissions, r._count.users,
        ] }))} />
    </>
  );
}
