import Link from "next/link";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { bankAccounts, journalsForSource } from "@/server/services/accounting";
import { Card } from "@/components/ui/primitives";
import { fmtAmount, fmtDate } from "@/lib/format";
import { D } from "@/lib/decimal";

/** General-ledger journals a document posted (shown to users with accounting.view). */
export async function JournalPanel({ user, sourceType, sourceId }: { user: SessionUser; sourceType: string; sourceId: string }) {
  if (!user.permissions.has("accounting.view")) return null;
  const journals = await journalsForSource(user, sourceType, sourceId);
  return (
    <Card title="Accounting entries" bodyClass="p-0">
      {journals.length === 0 ? <p className="px-4 py-3 text-sm text-ink-soft">Nothing posted to the ledger yet.</p> : journals.map((j) => (
        <div key={j.id} className="border-b border-line last:border-0">
          <div className="flex items-center justify-between px-4 pt-3 text-xs text-ink-soft">
            <Link className="link font-semibold" href={`/accounting/journals/${j.id}`}>{j.number}</Link>
            <span>{fmtDate(j.date)}{j.reversalOfId ? " · reversal" : ""}</span>
          </div>
          <table className="table-base text-xs">
            <thead><tr><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
            <tbody>{j.lines.map((l) => (
              <tr key={l.id}>
                <td className="w-full"><span className="font-mono">{l.account.code}</span> {l.account.name}</td>
                <td className="num">{D(l.debit).isZero() ? "" : fmtAmount(l.debit)}</td>
                <td className="num">{D(l.credit).isZero() ? "" : fmtAmount(l.credit)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </Card>
  );
}

/** Bank / cash accounts for payment forms, with the default bank account preselected. */
export async function bankAccountOptions() {
  const [accounts, def] = await Promise.all([bankAccounts(), prisma.accountDefault.findUnique({ where: { key: "BANK" } })]);
  return { options: accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })), defaultId: def?.accountId ?? accounts[0]?.id ?? "" };
}
