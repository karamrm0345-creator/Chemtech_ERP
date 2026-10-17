import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { AuthLayout } from "../auth-layout";
import { LoginForm } from "./form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSessionUser()) redirect("/");
  if ((await prisma.user.count()) === 0) redirect("/setup");
  const s = await prisma.companySettings.findUnique({ where: { id: 1 } });
  const { next } = await searchParams;
  return (
    <AuthLayout company={s?.companyName ?? "Chemtech"} title="Sign in">
      <LoginForm next={next ?? ""} />
    </AuthLayout>
  );
}
