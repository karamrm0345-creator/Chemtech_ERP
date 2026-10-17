import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { AuthLayout } from "../auth-layout";
import { SetupForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "First-time setup" };

export default async function SetupPage() {
  if ((await prisma.user.count()) > 0) redirect("/login");
  return (
    <AuthLayout company="Chemtech" title="Set up your company">
      <p className="-mt-3 mb-5 text-sm text-ink-soft">This one-time step creates the company profile and the first System Administrator. It is disabled once any user exists.</p>
      <SetupForm />
    </AuthLayout>
  );
}
