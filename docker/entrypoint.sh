#!/bin/sh
# Container start: migrate, seed reference data, optionally load demo data, then serve.
set -e

echo "▶ Applying database migrations"
node_modules/.bin/prisma migrate deploy

echo "▶ Seeding reference data (roles, currencies, units, numbering)"
node_modules/.bin/tsx prisma/seed-base.ts

if [ "${DEMO_SEED:-0}" = "1" ]; then
  if [ -z "$DEMO_PASSWORD" ]; then
    echo "✖ DEMO_SEED=1 needs DEMO_PASSWORD (min 10 characters, letters and numbers)." >&2
    exit 1
  fi
  echo "▶ Loading fictional demo data (skipped if already present)"
  # Local demo only: the seed refuses NODE_ENV=production, so run just this step as development.
  NODE_ENV=development ALLOW_DEMO_SEED=1 node_modules/.bin/tsx prisma/seed-demo.ts
fi

echo "▶ Chemtech ERP is starting on http://localhost:${PORT:-3000}"
exec node_modules/.bin/next start -p "${PORT:-3000}"
