import { requireUser } from "@/server/auth/session";
import type { SP } from "@/lib/params";
import { PaymentList } from "../payment-pages";

export const metadata = { title: "Supplier payments" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("finance.view");
  return <PaymentList side="supplier" user={user} sp={await searchParams} />;
}
