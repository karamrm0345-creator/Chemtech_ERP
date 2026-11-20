import { requireUser } from "@/server/auth/session";
import type { SP } from "@/lib/params";
import { PaymentList } from "../payment-pages";

export const metadata = { title: "Customer receipts" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("finance.view");
  return <PaymentList side="customer" user={user} sp={await searchParams} />;
}
