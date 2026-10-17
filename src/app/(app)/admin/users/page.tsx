import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { fmtDateTime } from "@/lib/format";
import { UserDialog } from "./user-dialog";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const me = await requireUser("admin.users");
  const { welcome } = await searchParams;
  const [users, roles] = await Promise.all([
    prisma.user.findMany({ include: { role: true }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
  ]);
  const roleOpts = roles.map((r) => ({ value: r.id, label: r.name }));
  return (
    <>
      <PageHeader title="Users" subtitle="Create accounts and assign roles. Users can change their own password." crumbs={[{ label: "Administration" }, { label: "Users" }]}
        actions={<UserDialog roles={roleOpts} />} />
      {welcome && <div className="mb-4"><Notice tone="success">Setup complete. Next: create user accounts for your General Manager, sales, procurement and store teams, and review <a className="link" href="/admin/settings">company settings</a>.</Notice></div>}
      <DataTable basePath="/admin/users" columns={[{ label: "Name" }, { label: "Email" }, { label: "Role" }, { label: "Department" }, { label: "Last sign-in" }, { label: "Status" }, { label: "" }]}
        rows={users.map((u) => ({ key: u.id, cells: [
          <span key="n" className="font-medium">{u.name}{u.id === me.userId && <span className="ml-1 text-xs text-ink-muted">(you)</span>}</span>,
          u.email, u.role.name, u.department, fmtDateTime(u.lastLoginAt), <StatusBadge key="s" status={u.active ? "ACTIVE" : "INACTIVE"} />,
          <UserDialog key="e" roles={roleOpts} user={{ id: u.id, name: u.name, email: u.email, phone: u.phone ?? "", department: u.department ?? "", roleId: u.roleId, active: u.active }} />,
        ] }))} />
    </>
  );
}
