#!/bin/sh
# Container start: migrate, seed reference data, optionally load demo data, then serve.
set -e

if [ "${DEMO_SEED:-0}" = "1" ]; then
  # Check the demo password first so a typo gives a clear message instead of a crash loop.
  case "$DEMO_PASSWORD" in *[A-Za-z]*) has_letter=1 ;; *) has_letter=0 ;; esac
  case "$DEMO_PASSWORD" in *[0-9]*) has_digit=1 ;; *) has_digit=0 ;; esac
  if [ ${#DEMO_PASSWORD} -lt 10 ] || [ $has_letter = 0 ] || [ $has_digit = 0 ]; then
    echo "✖ DEMO_PASSWORD must be at least 10 characters and contain letters and numbers (e.g. ChemDemo2026)." >&2
    exit 1
  fi
fi

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
