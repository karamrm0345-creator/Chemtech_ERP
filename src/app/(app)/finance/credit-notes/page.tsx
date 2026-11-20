import { requireUser } from "@/server/auth/session";
import type { SP } from "@/lib/params";
import { NoteList } from "../note-pages";

export const metadata = { title: "Credit notes" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("finance.view");
  return <NoteList kind="credit" user={user} sp={await searchParams} />;
}
