import { PrismaClient } from "@prisma/client";
import { seedBase } from "./seed-lib";

const prisma = new PrismaClient();
seedBase(prisma)
  .then(() => console.log("Base reference data seeded (roles, permissions, currencies, UoM, categories, numbering, settings)."))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
