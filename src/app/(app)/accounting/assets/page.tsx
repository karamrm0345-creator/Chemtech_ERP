import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listAssets } from "@/server/services/fixed-assets";
import { PageHeader, StatusBadge, LinkButton } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { QuickFormButton } from "@/components/forms/small-forms";
import { saveAssetAction, runDepreciationAction } from "@/app/actions/accounting";
import { listArgs, str, type SP } from "@/lib/params";
import { fmtAmount, fmtDate, humanize, toDateInput } from "@/lib/format";
import { D } from "@/lib/decimal";
import { assetFields, assetFormOptions } from "./options";

export const metadata = { title: "Fixed assets" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("accounting.view");
  const sp = await searchParams;
  const [data, o] = await Promise.all([listAssets(user, { ...listArgs(sp), status: str(sp, "status") }), assetFormOptions()]);
  const manage = user.permissions.has("accounting.assets.manage");
  const now = new Date();
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return (
    <>
      <PageHeader title="Fixed assets" subtitle={`Asset register. Net book value of assets in use: QAR ${fmtAmount(data.totals.cost.sub(data.totals.accumulated))} (cost ${fmtAmount(data.totals.cost)} less depreciation ${fmtAmount(data.totals.accumulated)}).`}
        crumbs={[{ label: "Accounting" }, { label: "Fixed assets" }]}
        actions={<>
          <LinkButton variant="outline" href="/accounting/assets/categories">Categories</LinkButton>
          {manage && <QuickFormButton label="Run depreciation" icon="none" title="Run depreciation" action={runDepreciationAction} initial={{ date: toDateInput(lastMonthEnd) }}
            note="Charges straight-line depreciation for every asset in use up to the end of the chosen month, including any months not yet charged. Each asset is charged once per month."
            fields={[{ name: "date", label: "Up to the end of the month containing", type: "date", required: true }]} />}
          {manage && <QuickFormButton variant="action" label="Register asset" title="Register fixed asset" action={saveAssetAction.bind(null, null)} redirectBase="/accounting/assets"
            initial={{ acquisitionDate: toDateInput(now), salvageValue: "0", openingAccumulated: "0", categoryId: o.categories[0]?.value ?? "" }} fields={assetFields(o)} />}
        </>} />
      <ListToolbar placeholder="Search number, name, serial, location…" filters={[{ name: "status", label: "Status", options: ["DRAFT", "ACTIVE", "FULLY_DEPRECIATED", "DISPOSED"].map((v) => ({ value: v, label: humanize(v) })) }]} />
      <DataTable basePath="/accounting/assets" sp={sp} total={data.total} page={data.page} pageSize={data.pageSize} empty="No fixed assets" emptyHint="Register equipment, vehicles and tools to depreciate them automatically."
        columns={[{ label: "Asset", sort: "number" }, { label: "Name", sort: "name" }, { label: "Category" }, { label: "Acquired", sort: "acquisitionDate" }, { label: "Cost", sort: "cost", align: "right" }, { label: "Depreciation", align: "right" }, { label: "Net book value", align: "right" }, { label: "Status", sort: "status" }]}
        rows={data.rows.map((a) => ({ key: a.id, cells: [
          <Link key="n" className="link" href={`/accounting/assets/${a.id}`}>{a.number}</Link>, a.name, a.category.name, fmtDate(a.acquisitionDate),
          fmtAmount(a.cost), fmtAmount(a.accumulatedDepreciation), a.status === "DISPOSED" ? "—" : fmtAmount(D(a.cost).sub(D(a.accumulatedDepreciation))), <StatusBadge key="s" status={a.status} />,
        ] }))} />
    </>
  );
}
