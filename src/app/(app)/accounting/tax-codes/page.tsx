import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { listTaxCodes } from "@/server/services/accounting";
import { PageHeader, Badge, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { QuickFormButton } from "@/components/forms/small-forms";
import { saveTaxCodeAction } from "@/app/actions/accounting";
import { fmtQty } from "@/lib/format";

export const metadata = { title: "Tax codes" };

export default async function Page() {
  const user = await requireUser("accounting.view");
  const [codes, accounts] = await Promise.all([listTaxCodes(), prisma.account.findMany({ where: { isGroup: false, active: true }, orderBy: { code: "asc" } })]);
  const manage = user.permissions.has("accounting.coa.manage");
  const opts = accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  const fields = (withActive: boolean) => [
    { name: "code", label: "Code (e.g. VAT5)", required: true }, { name: "name", label: "Name", required: true }, { name: "rate", label: "Rate %", required: true },
    { name: "outputAccountId", label: "Output tax account (sales)", type: "select" as const, options: opts },
    { name: "inputAccountId", label: "Input tax account (purchases)", type: "select" as const, options: opts },
    ...(withActive ? [{ name: "active", label: "Active", type: "select" as const, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }] : []),
  ];
  return (
    <>
      <PageHeader title="Tax codes" subtitle="Each document line carries a tax rate. When it is posted, the tax goes to the accounts of the active code with that rate; rates without a code use the default tax posting accounts."
        crumbs={[{ label: "Accounting" }, { label: "Tax codes" }]}
        actions={manage && <QuickFormButton variant="action" label="New tax code" title="New tax code" action={saveTaxCodeAction.bind(null, null)} fields={fields(false)} />} />
      <DataTable basePath="/accounting/tax-codes" empty="No tax codes" emptyHint="Without codes, all tax posts to the default Output / Input tax accounts."
        columns={[{ label: "Code" }, { label: "Name" }, { label: "Rate %", align: "right" }, { label: "Output account" }, { label: "Input account" }, { label: "Status" }, ...(manage ? [{ label: "" }] : [])]}
        rows={codes.map((t) => ({ key: t.id, cells: [
          <span key="c" className="font-mono text-xs">{t.code}</span>, t.name, fmtQty(t.rate),
          t.outputAccount ? `${t.outputAccount.code} ${t.outputAccount.name}` : "Default", t.inputAccount ? `${t.inputAccount.code} ${t.inputAccount.name}` : "Default",
          t.active ? <Badge key="a" tone="green">Active</Badge> : <Badge key="a" tone="amber">Inactive</Badge>,
          ...(manage ? [<QuickFormButton key="e" icon="edit" label="Edit" title={`Edit ${t.code}`} action={saveTaxCodeAction.bind(null, t.id)} fields={fields(true)}
            initial={{ code: t.code, name: t.name, rate: t.rate.toString(), outputAccountId: t.outputAccountId ?? "", inputAccountId: t.inputAccountId ?? "", active: t.active ? "yes" : "no" }} />] : []),
        ] }))} />
      <div className="mt-4"><Notice>Withholding tax deducted from supplier payments is set per supplier (supplier record → Withholding tax %) and posts to the Withholding tax payable account.</Notice></div>
    </>
  );
}
