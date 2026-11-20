import { prisma } from "@/server/db";

/** Accounts that can take postings, for journal line pickers. */
export async function postableAccounts() {
  const rows = await prisma.account.findMany({ where: { isGroup: false, active: true }, orderBy: { code: "asc" } });
  return rows.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
}

export async function costCenterOptions() {
  const rows = await prisma.costCenter.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  return rows.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }));
}
