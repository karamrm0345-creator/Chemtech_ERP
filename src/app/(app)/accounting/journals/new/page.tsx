import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { toDateInput } from "@/lib/format";
import { JournalForm } from "../journal-form";
import { postableAccounts } from "../accounts";

export const metadata = { title: "New journal" };

export default async function NewJournalPage() {
  await requireUser("accounting.journal.manage");
  return (
    <>
      <PageHeader title="New journal entry" subtitle="Saved as a draft. Another user with posting rights reviews and posts it."
        crumbs={[{ label: "Accounting" }, { label: "Journal entries", href: "/accounting/journals" }, { label: "New" }]} />
      <JournalForm accounts={await postableAccounts()} initial={{ date: toDateInput(new Date()), memo: "", reference: "", type: "MANUAL", lines: [] }} />
    </>
  );
}
