import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { PERMISSION_GROUPS } from "@/server/auth/permissions";
import { RoleForm } from "./role-form";

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("admin.roles");
  const { id } = await params;
  const role = id === "new" ? null : await prisma.role.findUnique({ where: { id }, include: { permissions: true, limits: true } });
  if (id !== "new" && !role) notFound();
  return (
    <>
      <PageHeader title={role ? `Role: ${role.name}` : "New role"} crumbs={[{ label: "Administration" }, { label: "Roles", href: "/admin/roles" }, { label: role?.name ?? "New" }]} />
      <RoleForm id={role?.id ?? null} groups={PERMISSION_GROUPS as unknown as Record<string, Record<string, string>>} isSystem={role?.isSystem ?? false}
        initial={{
          code: role?.code ?? "", name: role?.name ?? "", description: role?.description ?? "",
          permissions: role?.permissions.map((p) => p.permission) ?? [],
          limits: Object.fromEntries((role?.limits ?? []).map((l) => [l.docType, l.maxAmount === null ? "unlimited" : l.maxAmount.toString()])),
        }} />
    </>
  );
}
