import { requireUser } from "@/server/auth/session";
import type { SP } from "@/lib/params";
import { PaymentNew } from "../../payment-pages";

export const metadata = { title: "New receipt" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("finance.sales.manage");
  return <PaymentNew side="customer" user={user} sp={await searchParams} />;
}
