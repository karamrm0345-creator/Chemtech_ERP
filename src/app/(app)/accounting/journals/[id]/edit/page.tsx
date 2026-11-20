import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getJournal } from "@/server/services/accounting";
import { PageHeader } from "@/components/ui/primitives";
import { toDateInput } from "@/lib/format";
import { JournalForm } from "../../journal-form";
import { postableAccounts } from "../../accounts";

export const metadata = { title: "Edit journal" };

export default async function EditJournalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("accounting.journal.manage");
  const { id } = await params;
  const j = await getJournal(user, id);
  if (!j) notFound();
  if (j.status !== "DRAFT" || j.sourceType) redirect(`/accounting/journals/${id}`);
  return (
    <>
      <PageHeader title={`Edit ${j.number}`} crumbs={[{ label: "Accounting" }, { label: "Journal entries", href: "/accounting/journals" }, { label: j.number, href: `/accounting/journals/${id}` }, { label: "Edit" }]} />
      <JournalForm id={id} accounts={await postableAccounts()} initial={{
        date: toDateInput(j.date), memo: j.memo ?? "", reference: j.reference ?? "", type: j.type,
        lines: j.lines.map((l) => ({
          accountId: l.accountId, debit: Number(l.debit) ? l.debit.toFixed(2) : "", credit: Number(l.credit) ? l.credit.toFixed(2) : "",
          partyType: l.partyType ?? "", partyId: l.partyId ?? "", partyLabel: l.partyId ? j.parties.get(l.partyId) : undefined, description: l.description ?? "",
        })),
      }} />
    </>
  );
}
