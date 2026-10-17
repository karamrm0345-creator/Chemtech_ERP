import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { Shell } from "@/components/layout/shell";
import { navFor } from "@/components/layout/nav";
import { logoutAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const s = await prisma.companySettings.findUnique({ where: { id: 1 } });
  return (
    <Shell nav={navFor(user.permissions)} user={{ name: user.userName, email: user.email, role: user.roleName }} company={s?.companyName ?? "Chemtech"} logoutAction={logoutAction}>
      {children}
    </Shell>
  );
}
