import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Card, KeyValues, Notice } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { QuickFormButton } from "@/components/forms/small-forms";
import { JournalPanel } from "@/components/journal-panel";
import { HistoryPanel } from "@/components/panels";
import { PrintButton } from "@/components/print-button";
import { saveAssetAction, capitaliseAssetAction, disposeAssetAction } from "@/app/actions/accounting";
import { fmtAmount, fmtDate, toDateInput } from "@/lib/format";
import { D } from "@/lib/decimal";
import { assetFields, assetFormOptions } from "../options";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("accounting.view");
  const { id } = await params;
  const a = await prisma.fixedAsset.findUnique({ where: { id }, include: { category: { include: { assetAccount: true, accumulatedAccount: true, expenseAccount: true } }, costCenter: true, depreciation: { orderBy: { periodEnd: "asc" } } } });
  if (!a) notFound();
  const o = await assetFormOptions();
  const manage = user.permissions.has("accounting.assets.manage");
  const nbv = D(a.cost).sub(D(a.accumulatedDepreciation));
  const monthly = D(a.cost).sub(D(a.salvageValue)).div(a.usefulLifeMonths);
  const [journals] = await Promise.all([prisma.journalEntry.findMany({ where: { id: { in: a.depreciation.map((d) => d.journalId) } }, select: { id: true, number: true } })]);
  const jno = new Map(journals.map((j) => [j.id, j.number]));
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{a.number} <StatusBadge status={a.status} /></span>} subtitle={`${a.name} · ${a.category.name}`}
        crumbs={[{ label: "Accounting" }, { label: "Fixed assets", href: "/accounting/assets" }, { label: a.number }]}
        actions={<>
          {a.status === "DRAFT" && manage && <QuickFormButton icon="edit" label="Edit" title={`Edit ${a.number}`} action={saveAssetAction.bind(null, id)} fields={assetFields(o)}
            initial={{ name: a.name, categoryId: a.categoryId, acquisitionDate: toDateInput(a.acquisitionDate), depreciationStart: toDateInput(a.depreciationStart), cost: a.cost.toString(), salvageValue: a.salvageValue.toString(),
              usefulLifeMonths: String(a.usefulLifeMonths), openingAccumulated: a.openingAccumulated.toString(), serialNo: a.serialNo ?? "", location: a.location ?? "", costCenterId: a.costCenterId ?? "", notes: a.notes ?? "" }} />}
          {a.status === "DRAFT" && manage && <QuickFormButton variant="action" label="Capitalise" icon="none" title={`Capitalise ${a.number}`} action={capitaliseAssetAction.bind(null, id)}
            note={`Posts Dr ${a.category.assetAccount.code} ${a.category.assetAccount.name} ${fmtAmount(a.cost)}. Choose the account the purchase was paid from or booked to (bank, the expense or clearing account used on the supplier invoice, or Opening balance equity for assets brought over from another system).`}
            fields={[{ name: "fundingAccountId", label: "Funding account (credited)", type: "select", required: true, options: o.accounts }]} />}
          {["ACTIVE", "FULLY_DEPRECIATED"].includes(a.status) && manage && <QuickFormButton label="Dispose" icon="none" title={`Dispose of ${a.number}`} action={disposeAssetAction.bind(null, id)} initial={{ date: toDateInput(new Date()), proceeds: "0" }}
            note={`Net book value ${fmtAmount(nbv)}. Run depreciation up to the end of the previous month first. The difference between proceeds and net book value is posted as a gain or loss.`}
            fields={[{ name: "date", label: "Disposal date", type: "date", required: true }, { name: "proceeds", label: "Sale proceeds (QAR, 0 if scrapped)" }, { name: "proceedsAccountId", label: "Proceeds received into", type: "select", options: o.banks }, { name: "reason", label: "Reason", required: true }]} />}
          <PrintButton />
        </>} />
      {a.status === "DRAFT" && <div className="mb-4"><Notice>This asset is registered but not yet in the books. Capitalise it to post its cost and start depreciation.</Notice></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card><KeyValues items={[
            ["Cost", <b key="c">{fmtAmount(a.cost)}</b>], ["Accumulated depreciation", fmtAmount(a.accumulatedDepreciation)], ["Net book value", <b key="n">{a.status === "DISPOSED" ? "—" : fmtAmount(nbv)}</b>],
            ["Acquired", fmtDate(a.acquisitionDate)], ["Depreciation from", fmtDate(a.depreciationStart)], ["Useful life", `${a.usefulLifeMonths} months · ${fmtAmount(monthly)} per month`],
            ["Salvage value", fmtAmount(a.salvageValue)], ["Before go-live", fmtAmount(a.openingAccumulated)], ["Cost centre", a.costCenter ? `${a.costCenter.code} ${a.costCenter.name}` : "—"],
            ["Serial / tag", a.serialNo ?? "—"], ["Location", a.location ?? "—"], ["Disposed", a.disposedAt ? `${fmtDate(a.disposedAt)} · proceeds ${fmtAmount(a.disposalProceeds)}` : "—"],
            ["Accounts", `${a.category.assetAccount.code} / ${a.category.accumulatedAccount.code} / ${a.category.expenseAccount.code}`],
          ]} /></Card>
          <Card title="Depreciation schedule" bodyClass="p-0">
            <DataTable basePath={`/accounting/assets/${id}`} empty="No depreciation charged yet" columns={[{ label: "Up to" }, { label: "Journal" }, { label: "Charge", align: "right" }]}
              rows={a.depreciation.map((d) => ({ key: d.id, cells: [fmtDate(d.periodEnd), <Link key="j" className="link" href={`/accounting/journals/${d.journalId}`}>{jno.get(d.journalId) ?? "View"}</Link>, fmtAmount(d.amount)] }))} />
          </Card>
          {a.notes && <Notice>{a.notes}</Notice>}
        </div>
        <div className="no-print space-y-4">
          <JournalPanel user={user} sourceType="FixedAsset" sourceId={id} />
          <HistoryPanel entity="FixedAsset" entityId={id} />
        </div>
      </div>
    </>
  );
}
