import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { QuickFormButton } from "@/components/forms/small-forms";
import { saveAssetCategoryAction } from "@/app/actions/accounting";

export const metadata = { title: "Asset categories" };

export default async function Page() {
  const user = await requireUser("accounting.view");
  const [cats, accounts] = await Promise.all([
    prisma.assetCategory.findMany({ orderBy: { name: "asc" }, include: { assetAccount: true, accumulatedAccount: true, expenseAccount: true, _count: { select: { assets: true } } } }),
    prisma.account.findMany({ where: { isGroup: false, active: true }, orderBy: { code: "asc" } }),
  ]);
  const opt = (t: string) => accounts.filter((a) => a.type === t).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  const fields = [
    { name: "name", label: "Name", required: true }, { name: "usefulLifeMonths", label: "Default useful life (months)", required: true },
    { name: "assetAccountId", label: "Asset (cost) account", type: "select" as const, required: true, options: opt("ASSET") },
    { name: "accumulatedAccountId", label: "Accumulated depreciation account", type: "select" as const, required: true, options: opt("ASSET") },
    { name: "expenseAccountId", label: "Depreciation expense account", type: "select" as const, required: true, options: opt("EXPENSE") },
  ];
  const manage = user.permissions.has("accounting.assets.manage");
  return (
    <>
      <PageHeader title="Asset categories" subtitle="Each category sets the ledger accounts and default useful life for its assets."
        crumbs={[{ label: "Accounting" }, { label: "Fixed assets", href: "/accounting/assets" }, { label: "Categories" }]}
        actions={manage && <QuickFormButton variant="action" label="New category" title="New asset category" action={saveAssetCategoryAction.bind(null, null)} initial={{ usefulLifeMonths: "60" }} fields={fields} />} />
      <DataTable basePath="/accounting/assets/categories" empty="No categories"
        columns={[{ label: "Category" }, { label: "Life (months)", align: "right" }, { label: "Asset account" }, { label: "Accumulated depreciation" }, { label: "Expense" }, { label: "Assets", align: "right" }, ...(manage ? [{ label: "" }] : [])]}
        rows={cats.map((c) => ({ key: c.id, cells: [c.name, c.usefulLifeMonths, `${c.assetAccount.code} ${c.assetAccount.name}`, `${c.accumulatedAccount.code} ${c.accumulatedAccount.name}`, `${c.expenseAccount.code} ${c.expenseAccount.name}`, c._count.assets,
          ...(manage ? [<QuickFormButton key="e" icon="edit" label="Edit" title={`Edit ${c.name}`} action={saveAssetCategoryAction.bind(null, c.id)} fields={fields}
            initial={{ name: c.name, usefulLifeMonths: String(c.usefulLifeMonths), assetAccountId: c.assetAccountId, accumulatedAccountId: c.accumulatedAccountId, expenseAccountId: c.expenseAccountId }} />] : [])] }))} />
    </>
  );
}
