// Posts general-ledger journals for documents posted before accounting was enabled. Safe to re-run.
import { backfillLedger } from "../src/server/accounting/backfill";
import { prisma } from "../src/server/db";

backfillLedger((m) => console.log(`  ${m}`))
  .then((c) => console.log(Object.keys(c).length ? "Ledger backfill complete." : "Ledger is up to date (nothing to backfill)."))
  .catch((e) => { console.error(`✖ Ledger backfill failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
