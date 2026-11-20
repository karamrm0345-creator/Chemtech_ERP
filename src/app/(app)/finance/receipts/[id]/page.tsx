import { requireUser } from "@/server/auth/session";
import { PaymentDetail } from "../../payment-pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("finance.view");
  return <PaymentDetail side="customer" user={user} id={(await params).id} />;
}
