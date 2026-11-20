// Reference data required in every environment (no business records, no users).
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_ROLES, PERMISSION_UPGRADES } from "../src/server/auth/permissions";
import { POSTING_KEYS, STANDARD_CHART, type PostingKey } from "../src/server/accounting/chart";
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

  const settings = await prisma.companySettings.upsert({
    where: { id: 1 },
    create: { id: 1, companyName: "Chemtech", legalName: "Chemtech", baseCurrency: "QAR", timeZone: "Asia/Qatar" },
    update: {},
  });

  // One-time grants of permissions introduced after first release, to default roles that list them.
  for (const up of PERMISSION_UPGRADES.filter((u) => u.version > settings.permissionsVersion)) {
    for (const r of DEFAULT_ROLES) {
      const role = await prisma.role.findUniqueOrThrow({ where: { code: r.code } });
      const grant = up.permissions.filter((p) => r.permissions.includes(p));
      if (grant.length) await prisma.rolePermission.createMany({ data: grant.map((permission) => ({ roleId: role.id, permission })), skipDuplicates: true });
    }
    await prisma.companySettings.update({ where: { id: 1 }, data: { permissionsVersion: up.version } });
  }

  // Chart of accounts: seeded only into an empty chart, so finance's own structure is never overwritten.
  if ((await prisma.account.count()) === 0) {
    const ids = new Map<string, string>();
    for (const a of STANDARD_CHART) {
      const acc = await prisma.account.create({
        data: { code: a.code, name: a.name, type: a.type, isGroup: !!a.group, isBank: !!a.bank, cashFlowCategory: a.cashFlow ?? null, parentId: a.parent ? ids.get(a.parent) : null },
      });
      ids.set(a.code, acc.id);
    }
  }
  for (const key of Object.keys(POSTING_KEYS) as PostingKey[]) {
    const std = STANDARD_CHART.find((a) => a.key === key);
    let acc = std ? await prisma.account.findUnique({ where: { code: std.code } }) : null;
    // Upgrades: posting accounts added in later releases are created in an existing chart when their code is free.
    if (std && !acc && !(await prisma.accountDefault.findUnique({ where: { key } }))) {
      const parent = std.parent ? await prisma.account.findUnique({ where: { code: std.parent } }) : null;
      acc = await prisma.account.create({ data: { code: std.code, name: std.name, type: std.type, parentId: parent?.isGroup ? parent.id : null } });
    }
    if (acc && !(await prisma.accountDefault.findUnique({ where: { key } }))) await prisma.accountDefault.create({ data: { key, accountId: acc.id } });
  }

  // A default fixed-asset category on the standard accounts, when none exists yet.
  if ((await prisma.assetCategory.count()) === 0) {
    const [ppe, acc, dep] = await Promise.all(["1210", "1220", "6500"].map((code) => prisma.account.findUnique({ where: { code } })));
    if (ppe && acc && dep && !ppe.isGroup && !acc.isGroup && !dep.isGroup) {
      await prisma.assetCategory.create({ data: { name: "Equipment and tools", assetAccountId: ppe.id, accumulatedAccountId: acc.id, expenseAccountId: dep.id, usefulLifeMonths: 60 } });
    }
  }

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
