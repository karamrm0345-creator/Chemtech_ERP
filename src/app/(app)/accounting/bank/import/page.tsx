import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, Notice } from "@/components/ui/primitives";
import { ImportForm } from "./form";

export const metadata = { title: "Import bank statement" };

export default async function Page() {
  await requireUser("accounting.bank.reconcile");
  const [all, def] = await Promise.all([
    prisma.account.findMany({ where: { isBank: true, isGroup: false, active: true }, orderBy: { code: "asc" } }),
    prisma.accountDefault.findUnique({ where: { key: "BANK" } }),
  ]);
  // The main bank account first, so it is preselected.
  const banks = [...all.filter((b) => b.id === def?.accountId), ...all.filter((b) => b.id !== def?.accountId)];
  const last = await Promise.all(banks.map((b) => prisma.bankStatement.findFirst({ where: { accountId: b.id }, orderBy: { statementDate: "desc" } })));
  const suggestions = Object.fromEntries(banks.map((b, i) => [b.id, last[i] ? last[i]!.closingBalance.toString() : ""]));
  return (
    <>
      <PageHeader title="Import bank statement" crumbs={[{ label: "Accounting" }, { label: "Bank reconciliation", href: "/accounting/bank" }, { label: "Import" }]} />
      {banks.length ? <ImportForm banks={banks.map((b) => ({ value: b.id, label: `${b.code} ${b.name}` }))} suggestions={suggestions} /> : <Notice tone="warning">Mark at least one account as Bank / cash in the chart of accounts.</Notice>}
    </>
  );
}
