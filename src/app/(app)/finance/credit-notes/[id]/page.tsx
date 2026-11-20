import { requireUser } from "@/server/auth/session";
import { NoteDetail } from "../../note-pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("finance.view");
  return <NoteDetail kind="credit" user={user} id={(await params).id} />;
}
