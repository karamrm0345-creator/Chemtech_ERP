import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { chartOfAccounts, postingAccounts } from "@/server/services/accounting";
import { PageHeader, Card, Badge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { QuickFormButton } from "@/components/forms/small-forms";
import { createAccountAction, updateAccountAction, setPostingAccountAction } from "@/app/actions/accounting";
import { fmtAmount, humanize } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Chart of accounts" };

const TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"].map((t) => ({ value: t, label: humanize(t) }));
const YES_NO = [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }];

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ inactive?: string }> }) {
  const user = await requireUser("accounting.view");
  const { inactive } = await searchParams;
  const [nodes, posting] = await Promise.all([chartOfAccounts(user, { includeInactive: inactive === "1" }), postingAccounts(user)]);
  const manage = user.permissions.has("accounting.coa.manage");
  const groups = nodes.filter((n) => n.isGroup).map((n) => ({ value: n.id, label: `${n.code} ${n.name}` }));
  const postable = nodes.filter((n) => !n.isGroup && n.active).map((n) => ({ value: n.id, label: `${n.code} ${n.name}` }));
  const accountFields = (withActive: boolean) => [
    { name: "code", label: "Code", required: true }, { name: "name", label: "Name", required: true },
    { name: "type", label: "Type", type: "select" as const, required: true, options: TYPES },
    { name: "parentId", label: "Parent group", type: "select" as const, options: groups },
    { name: "isGroup", label: "Group account (holds sub-accounts, no postings)", type: "select" as const, options: YES_NO },
    { name: "isBank", label: "Bank / cash account (selectable on payments)", type: "select" as const, options: YES_NO },
    ...(withActive ? [{ name: "active", label: "Active", type: "select" as const, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }] : []),
    { name: "description", label: "Description", type: "textarea" as const },
  ];
  return (
    <>
      <PageHeader title="Chart of accounts" subtitle="Balances are from posted journals in base currency. Group accounts total their sub-accounts."
        crumbs={[{ label: "Accounting" }, { label: "Chart of accounts" }]}
        actions={<>
          <Link className="link text-sm" href={inactive === "1" ? "/accounting/accounts" : "/accounting/accounts?inactive=1"}>{inactive === "1" ? "Hide inactive" : "Show inactive"}</Link>
          {manage && <QuickFormButton variant="action" label="New account" title="New account" action={createAccountAction} initial={{ type: "EXPENSE", isGroup: "no", isBank: "no" }} fields={accountFields(false)} />}
        </>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DataTable basePath="/accounting/accounts" empty="No accounts" emptyHint="Run the base seed to install the standard chart."
            columns={[{ label: "Code" }, { label: "Account" }, { label: "Type" }, { label: "" }, { label: "Balance", align: "right" }, ...(manage ? [{ label: "" }] : [])]}
            rows={nodes.map((n) => ({
              key: n.id, className: n.isGroup ? "bg-panel/60" : undefined,
              cells: [
                <span key="c" className="font-mono text-xs">{n.code}</span>,
                <span key="n" style={{ paddingLeft: `${n.depth * 1.25}rem` }} className={cn(n.isGroup && "font-semibold", !n.active && "text-ink-soft line-through")}>
                  {n.isGroup ? n.name : <Link className="link" href={`/accounting/ledger?account=${n.id}`}>{n.name}</Link>}
                </span>,
                humanize(n.type),
                <span key="b" className="flex gap-1">{n.isBank && <Badge tone="blue">Bank</Badge>}{!n.active && <Badge tone="amber">Inactive</Badge>}</span>,
                <span key="v" className={cn(n.isGroup && "font-semibold", n.balance.lt(0) && "text-red-600")}>{fmtAmount(n.balance)}</span>,
                ...(manage ? [<QuickFormButton key="e" icon="edit" label="Edit" title={`Edit ${n.code} ${n.name}`} action={updateAccountAction.bind(null, n.id)} fields={accountFields(true)}
                  initial={{ code: n.code, name: n.name, type: n.type, parentId: n.parentId ?? "", isGroup: n.isGroup ? "yes" : "no", isBank: n.isBank ? "yes" : "no", active: n.active ? "yes" : "no", description: n.description ?? "" }} />] : []),
              ],
            }))} />
        </div>
        <Card title="Posting accounts" bodyClass="p-0">
          <p className="px-4 pt-3 text-xs text-ink-soft">Invoices, payments and stock movements post automatically to these accounts.</p>
          <table className="table-base text-sm">
            <tbody>{posting.map((p) => (
              <tr key={p.key}>
                <td><div className="text-xs text-ink-soft">{p.label}</div><div>{p.account ? <><span className="font-mono text-xs">{p.account.code}</span> {p.account.name}</> : <span className="text-red-600">Not set</span>}</div></td>
                {manage && <td className="text-right"><QuickFormButton icon="edit" label="Change" title={p.label} action={setPostingAccountAction.bind(null, p.key)} initial={{ accountId: p.account?.id ?? "" }}
                  fields={[{ name: "accountId", label: "Account", type: "select", required: true, options: postable }]} /></td>}
              </tr>
            ))}</tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
