import { requireUser } from "@/server/auth/session";
import type { SP } from "@/lib/params";
import { PaymentNew } from "../../payment-pages";

export const metadata = { title: "New payment" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("finance.purchase.manage");
  return <PaymentNew side="supplier" user={user} sp={await searchParams} />;
}
