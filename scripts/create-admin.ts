/**
 * Creates a System Administrator from environment variables (no defaults).
 * Usage: ADMIN_EMAIL=… ADMIN_NAME=… ADMIN_PASSWORD=… npm run admin:create
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword, passwordProblem } from "../src/server/auth/password";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || "System Administrator";
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email) throw new Error("ADMIN_EMAIL is required.");
  const p = passwordProblem(password);
  if (p) throw new Error(`ADMIN_PASSWORD: ${p}`);
  const role = await prisma.role.findUnique({ where: { code: "SYSTEM_ADMIN" } });
  if (!role) throw new Error("Run `npm run db:seed:base` first.");
  if (await prisma.user.findUnique({ where: { email } })) throw new Error(`User ${email} already exists.`);
  const u = await prisma.user.create({ data: { email, name, roleId: role.id, passwordHash: await hashPassword(password) } });
  await prisma.auditLog.create({ data: { action: "CREATE", entity: "User", entityId: u.id, summary: `Administrator ${email} created from CLI` } });
  console.log(`Created administrator ${email}.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
