import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listCostCenters } from "@/server/services/accounting";
import { PageHeader, Badge } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { QuickFormButton } from "@/components/forms/small-forms";
import { saveCostCenterAction } from "@/app/actions/accounting";

export const metadata = { title: "Cost centres" };

const FIELDS = [{ name: "code", label: "Code", required: true }, { name: "name", label: "Name", required: true },
  { name: "active", label: "Active", type: "select" as const, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }];

export default async function Page() {
  const user = await requireUser("accounting.view");
  const rows = await listCostCenters({ includeInactive: true });
  const manage = user.permissions.has("accounting.coa.manage");
  return (
    <>
      <PageHeader title="Cost centres" subtitle="Divisions or projects that income and expense can be reported by (e.g. Well testing, Chemicals, a contract). Pick one on invoices and journal lines."
        crumbs={[{ label: "Accounting" }, { label: "Cost centres" }]}
        actions={manage && <QuickFormButton variant="action" label="New cost centre" title="New cost centre" action={saveCostCenterAction.bind(null, null)} initial={{ active: "yes" }} fields={FIELDS.slice(0, 2)} />} />
      <DataTable basePath="/accounting/cost-centers" empty="No cost centres yet" emptyHint="Create one for each division or project you want a separate profit & loss for."
        columns={[{ label: "Code" }, { label: "Name" }, { label: "Status" }, { label: "" }, ...(manage ? [{ label: "" }] : [])]}
        rows={rows.map((c) => ({ key: c.id, cells: [
          <span key="c" className="font-mono text-xs">{c.code}</span>, c.name, c.active ? <Badge key="a" tone="green">Active</Badge> : <Badge key="a" tone="amber">Inactive</Badge>,
          <Link key="p" className="link text-sm" href={`/accounting/profit-loss?costCenter=${c.id}`}>Profit & loss</Link>,
          ...(manage ? [<QuickFormButton key="e" icon="edit" label="Edit" title={`Edit ${c.code}`} action={saveCostCenterAction.bind(null, c.id)} initial={{ code: c.code, name: c.name, active: c.active ? "yes" : "no" }} fields={FIELDS} />] : []),
        ] }))} />
    </>
  );
}
