import { prisma } from "@/server/db";

/** Shared select options for asset forms. */
export async function assetFormOptions() {
  const [cats, centres, accounts] = await Promise.all([
    prisma.assetCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.costCenter.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.account.findMany({ where: { isGroup: false, active: true }, orderBy: { code: "asc" } }),
  ]);
  return {
    categories: cats.map((c) => ({ value: c.id, label: `${c.name} (${c.usefulLifeMonths} months)` })),
    costCenters: centres.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` })),
    accounts: accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })),
    banks: accounts.filter((a) => a.isBank).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })),
  };
}

export function assetFields(o: Awaited<ReturnType<typeof assetFormOptions>>) {
  return [
    { name: "name", label: "Asset name", required: true },
    { name: "categoryId", label: "Category", type: "select" as const, required: true, options: o.categories },
    { name: "acquisitionDate", label: "Acquisition date", type: "date" as const, required: true },
    { name: "depreciationStart", label: "Depreciation starts (blank = acquisition date)", type: "date" as const },
    { name: "cost", label: "Cost (QAR)", required: true },
    { name: "salvageValue", label: "Salvage value (QAR)" },
    { name: "usefulLifeMonths", label: "Useful life in months (blank = category default)" },
    { name: "openingAccumulated", label: "Depreciation already charged before go-live (QAR)" },
    { name: "serialNo", label: "Serial / tag number" },
    { name: "location", label: "Location" },
    { name: "costCenterId", label: "Cost centre", type: "select" as const, options: o.costCenters },
    { name: "notes", label: "Notes", type: "textarea" as const },
  ];
}
