import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { navFor } from "@/components/layout/nav";

export default async function Home() {
  const u = await requireUser();
  const first = navFor(u.permissions)[0]?.items[0]?.href;
  redirect(first ?? "/account/password");
}
