import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { listCustomers } from "@/server/services/customers";
import { PageHeader, LinkButton, StatusBadge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { listArgs, str, type SP } from "@/lib/params";
import { fmtMoney } from "@/lib/format";
import { CUSTOMER_CATEGORIES, CUSTOMER_CATEGORY_LABEL } from "@/lib/options";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("customer.view");
  const sp = await searchParams;
  const data = await listCustomers(user, { ...listArgs(sp), category: str(sp, "category"), active: str(sp, "active") });
  return (
    <>
      <PageHeader title="Customers" subtitle={`${data.total} customer record(s)`} crumbs={[{ label: "Sales" }, { label: "Customers" }]}
        actions={user.permissions.has("customer.manage") && <LinkButton href="/customers/new" variant="action"><Plus className="h-4 w-4" /> New customer</LinkButton>} />
      <ListToolbar placeholder="Search name, code or email…" filters={[
        { name: "category", label: "Category", options: CUSTOMER_CATEGORIES.map((c) => ({ value: c, label: CUSTOMER_CATEGORY_LABEL[c] })) },
        { name: "active", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
      ]} />
      <DataTable basePath="/customers" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize}
        empty="No customers yet" emptyHint="Create your first customer to start quoting."
        columns={[{ label: "Code", sort: "code" }, { label: "Customer", sort: "legalName" }, { label: "Category", sort: "category" }, { label: "Country" }, { label: "Contact" }, { label: "Credit limit", sort: "creditLimit", align: "right" }, { label: "Status" }]}
        rows={data.rows.map((c) => ({
          key: c.id,
          cells: [
            <Link key="c" href={`/customers/${c.id}`} className="link">{c.code}</Link>,
            <div key="n"><Link href={`/customers/${c.id}`} className="font-medium hover:text-brand-600">{c.legalName}</Link>{c.tradingName && <div className="text-xs text-ink-muted">{c.tradingName}</div>}</div>,
            CUSTOMER_CATEGORY_LABEL[c.category],
            c.country,
            <div key="e" className="text-xs">{c.email}<div className="text-ink-muted">{c.phone}</div></div>,
            fmtMoney(c.creditLimit, c.currency),
            <StatusBadge key="s" status={c.active ? "ACTIVE" : "INACTIVE"} />,
          ],
        }))} />
    </>
  );
}
