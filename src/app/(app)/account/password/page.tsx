import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { PasswordForm } from "./form";

export const metadata = { title: "Change password" };

export default async function Page() {
  await requireUser();
  return (
    <div className="max-w-md">
      <PageHeader title="Change password" crumbs={[{ label: "Account" }, { label: "Password" }]} />
      <PasswordForm />
    </div>
  );
}
