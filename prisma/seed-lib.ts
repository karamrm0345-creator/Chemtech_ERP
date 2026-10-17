// Reference data required in every environment (no business records, no users).
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_ROLES } from "../src/server/auth/permissions";
import { DOC_TYPES } from "../src/server/numbering";

export async function seedBase(prisma: PrismaClient) {
  for (const r of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      create: { code: r.code, name: r.name, description: r.description, isSystem: true },
      update: {},
    });
    // Only seed permissions for roles that have none, so admin changes are kept.
    if ((await prisma.rolePermission.count({ where: { roleId: role.id } })) === 0) {
      await prisma.rolePermission.createMany({ data: r.permissions.map((permission) => ({ roleId: role.id, permission })) });
    }
  }

  await prisma.companySettings.upsert({
    where: { id: 1 },
    create: { id: 1, companyName: "Chemtech", legalName: "Chemtech", baseCurrency: "QAR", timeZone: "Asia/Qatar" },
    update: {},
  });

  const currencies = [
    { code: "QAR", name: "Qatari Riyal", rateToBase: 1 },
    { code: "USD", name: "US Dollar", rateToBase: 3.64 },
    { code: "EUR", name: "Euro", rateToBase: 3.95 },
    { code: "GBP", name: "Pound Sterling", rateToBase: 4.6 },
    { code: "AED", name: "UAE Dirham", rateToBase: 0.9911 },
    { code: "SAR", name: "Saudi Riyal", rateToBase: 0.9707 },
  ];
  for (const c of currencies) await prisma.currency.upsert({ where: { code: c.code }, create: c, update: {} });

  for (const [docType, cfg] of Object.entries(DOC_TYPES)) {
    await prisma.documentSequence.upsert({ where: { docType }, create: { docType, ...cfg, nextNumber: 1 }, update: {} });
  }

  const uoms = [
    ["EA", "Each"], ["PCS", "Pieces"], ["SET", "Set"], ["KG", "Kilogram"], ["LTR", "Litre"], ["DRUM", "Drum"],
    ["M", "Metre"], ["BOX", "Box"], ["PAIL", "Pail"], ["IBC", "IBC Tote"], ["HR", "Hour"], ["DAY", "Day"], ["LOT", "Lot"], ["JOB", "Job"],
  ];
  for (const [code, name] of uoms) await prisma.unitOfMeasure.upsert({ where: { code }, create: { code, name }, update: {} });

  const cats = [
    ["CHEM", "Industrial Chemicals"], ["SPARE", "Spare Parts"], ["SLICK", "Slickline Tools"], ["WI", "Well Intervention Equipment"],
    ["WT", "Well Testing Equipment"], ["PCE", "Pressure Control Equipment"], ["VALVE", "Valves & Fittings"], ["CONS", "Consumables"],
    ["ACC", "Equipment Accessories"], ["PPE", "PPE & General Supplies"], ["SERV", "Services"],
  ];
  for (const [code, name] of cats) await prisma.itemCategory.upsert({ where: { code }, create: { code, name }, update: {} });

  if ((await prisma.evaluationCriterion.count()) === 0) {
    await prisma.evaluationCriterion.createMany({
      data: [
        { name: "Price", weight: 40, sort: 1 },
        { name: "Delivery time", weight: 20, sort: 2 },
        { name: "Technical compliance", weight: 25, sort: 3 },
        { name: "Payment terms", weight: 10, sort: 4 },
        { name: "HSE / quality record", weight: 5, sort: 5 },
      ],
    });
  }

  const limits: [string, string, number | null][] = [
    ["GENERAL_MANAGER", "SALES_QUOTATION", null], ["GENERAL_MANAGER", "SALES_ORDER", null], ["GENERAL_MANAGER", "PURCHASE_REQUEST", null],
    ["GENERAL_MANAGER", "PURCHASE_ORDER", null], ["GENERAL_MANAGER", "STOCK_ADJUSTMENT", null],
    ["SALES_MANAGER", "SALES_QUOTATION", 500000], ["SALES_MANAGER", "SALES_ORDER", 500000],
    ["PROCUREMENT_MANAGER", "PURCHASE_REQUEST", 250000], ["PROCUREMENT_MANAGER", "PURCHASE_ORDER", 250000],
    ["STORE_MANAGER", "STOCK_ADJUSTMENT", 20000],
  ];
  for (const [roleCode, docType, max] of limits) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    await prisma.approvalLimit.upsert({
      where: { roleId_docType: { roleId: role.id, docType } },
      create: { roleId: role.id, docType, maxAmount: max },
      update: {},
    });
  }
}
