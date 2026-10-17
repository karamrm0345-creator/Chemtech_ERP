import { execSync } from "node:child_process";

/**
 * Prepares the dedicated test database non-destructively: applies pending
 * migrations and the idempotent base seed. Tests create uniquely coded
 * records, so no reset between runs is needed.
 */
export default async function setup() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/_test(\?|$)/.test(url)) throw new Error(`Refusing to run tests against a non-test database: ${url}`);
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: url } });
  const { PrismaClient } = await import("@prisma/client");
  const { seedBase } = await import("../prisma/seed-lib");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await seedBase(prisma);
  await prisma.$disconnect();
}
