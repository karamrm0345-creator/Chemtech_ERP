# Chemtech ERP

An integrated ERP web application for **Chemtech, Qatar** (oil & gas services and supply).
Six modules share **one PostgreSQL database**:

| Module | Highlights |
|---|---|
| **General Manager dashboard** | Live KPIs (confirmed revenue vs order intake vs pipeline), purchases, inventory value, low / out of stock, open & overdue orders, pending approvals, receivables / payables; monthly trends, rankings, stock movement, slow-moving stock; actionable alerts; date / customer / supplier / category filters; every KPI links to its records |
| **Sales** | Quotations (Draft → Submitted → Approved → Sent → Accepted/Rejected → Converted, with revisions), sales orders, availability & stock reservation, delivery orders that issue stock exactly once, shortage → purchase request, sales invoices & receipts |
| **Procurement** | Purchase requests with approval, RFQs, supplier quotations with a weighted comparison screen, purchase orders (freight, multi-currency, partial-delivery policy), goods receipts with tolerance/rejections/batch/expiry/serial capture, returns to supplier, supplier invoices with 3-way matching & payments |
| **Store & inventory** | Item master (product, chemical, equipment, spare part, consumable, service; stock / serialized asset / rental / non-stock), multi-warehouse with bin locations, immutable stock ledger, opening balances, adjustments (approval + limits), transfers, internal issues, physical counts, reversals, batch/lot & expiry (FEFO), serial numbers, weighted-average landed cost, stock card, low-stock replenishment |
| **Customers** | Profile, contacts, credit limit, duplicate detection, full transaction history (quotes, orders, deliveries, invoices), documents |
| **Suppliers** | Profile, contacts, role-protected bank details, prequalification, certificates with expiry, quality issues / NCRs, delivery performance, quotation / PO / GRN / invoice history |

Cross-cutting: role-based permissions enforced server-side, approval limits by role and value,
separation of duties, audit trail with before/after values, secure attachments, reports with
Excel/CSV export and print-to-PDF, configurable document numbering, QAR base currency with
multi-currency documents, Asia/Qatar time zone.

---

## 1. Technology

- **Next.js 15** (App Router, Server Components, Server Actions) + **TypeScript** + **React 19**
- **Tailwind CSS 3** design system modelled on the reference screenshot (brand blue, green primary action, light grey-blue canvas)
- **PostgreSQL 16** + **Prisma 6** (schema + SQL migrations)
- **Recharts** (charts), **ExcelJS** (Excel export), **Zod** (validation), **bcryptjs** (password hashing)
- **Vitest** integration tests against a real PostgreSQL test database

Architecture:

```
src/
  server/            ← all business logic (never imported by client components)
    services/        ← customers, suppliers, items, inventory-engine, inventory, sales,
                       purchasing, finance, dashboard, reports, attachments, admin, auth
    auth/            ← sessions, password policy, rate limiting, permission catalog
    approvals.ts     ← permission + separation of duties + value limits
    numbering.ts     ← atomic document numbering
    audit.ts         ← audit log writer
  app/
    (auth)/          ← login, first-run setup
    (app)/           ← authenticated pages for every module
    actions/         ← thin server actions → services
    api/             ← lookups, report export, attachment download
  components/        ← UI primitives, data table, forms, charts, printable documents
prisma/              ← schema, migrations, base seed, demo seed
tests/               ← integration tests (real database)
```

Every service function receives the acting user (`Ctx`) and checks permissions itself, so the
rules hold no matter which UI or API calls them.

## 2. Requirements

- Node.js 20+ (developed on 22)
- PostgreSQL 14+ (developed on 16)

## 3. Installation (development)

```bash
git clone <repo> chemtech-erp && cd chemtech-erp
npm install

# Create databases (adjust user/password to your environment)
sudo -u postgres psql -c "CREATE USER chemtech WITH PASSWORD 'choose-a-password' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE chemtech_erp OWNER chemtech;"
sudo -u postgres psql -c "CREATE DATABASE chemtech_erp_test OWNER chemtech;"   # for tests

cp .env.example .env            # then edit DATABASE_URL and SESSION_SECRET
npx prisma migrate deploy        # apply migrations
npm run db:seed:base             # roles, permissions, currencies, UoM, categories, numbering, settings
npm run dev                      # http://localhost:3000
```

Open the app. When no users exist it redirects to **`/setup`**, which creates the company name and the
**first System Administrator** with a password you choose. This one-time page refuses to run once any
user exists. There is **no default password** anywhere in the system.

Alternatively, create the first administrator from the command line:

```bash
ADMIN_EMAIL=admin@yourco.qa ADMIN_NAME="IT Admin" ADMIN_PASSWORD='a-strong-password-123' npm run admin:create
```

### Optional demo data (development only)

```bash
ALLOW_DEMO_SEED=1 DEMO_PASSWORD='SomeDemoPass123' npm run db:seed:demo
```

This creates **fictional** customers, suppliers, chemicals, spare parts, equipment, warehouses and
about ten months of quotations, orders, deliveries, purchase orders, receipts, invoices and stock movements. Every record is
coded `DEMO-…`, named `… (Demo)` and flagged `isDemo`. The script refuses to run when
`NODE_ENV=production` or without `ALLOW_DEMO_SEED=1`. It creates one demo user per role
(`gm@chemtech.demo`, `sales.manager@chemtech.demo`, `sales.officer@chemtech.demo`,
`procurement.manager@…`, `procurement.officer@…`, `store.manager@…`, `storekeeper@…`, `finance@…`,
`auditor@…`, `admin@chemtech.demo`), all with the `DEMO_PASSWORD` you supply.
All transactions are created through the real services, so the ledger and document links are consistent.

## 4. Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Reserved for signing; use a long random value |
| `UPLOAD_DIR` | Directory for attachments, **outside** any public folder (default `./storage/uploads`) |
| `INSECURE_COOKIES=1` | Only if serving production over plain HTTP on a private network (not recommended) |

Never commit `.env`. `.env.example` contains placeholders only.

## 5. Tests

```bash
# .env.test must point at a database whose name ends in _test
echo 'DATABASE_URL="postgresql://chemtech:PASSWORD@localhost:5432/chemtech_erp_test?schema=public"' > .env.test
npm test
```

The test setup applies migrations to the test database and seeds reference data. It refuses to run if the
database name does not end in `_test`. Tests create uniquely-coded records, so no reset is needed
between runs. See [`docs/TESTING.md`](docs/TESTING.md) for the scenario list and latest results.

A browser smoke test that opens every page type is also provided:

```bash
npm run dev   # in another terminal
node scripts/crawl-pages.mjs <email> <password>
```

## 6. Production deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full guide. In short:

```bash
npm ci
npx prisma migrate deploy
npm run db:seed:base          # idempotent; safe to re-run
npm run build
NODE_ENV=production npm start # behind HTTPS reverse proxy (nginx/Caddy), port 3000
```

Then create the first administrator via `/setup` or `npm run admin:create`. **Never run the demo seed in production.**

## 7. Database: migrations, backup, restore

- Schema: `prisma/schema.prisma`; migrations: `prisma/migrations/*` (plain SQL, reviewed into git).
- Apply: `npx prisma migrate deploy`.
- New migration in development: edit the schema, then `npx prisma migrate dev --name <change>`.
- Backup / restore / integrity checks: see [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## 8. Users and roles

See [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md). Ten default roles are seeded (General Manager,
Sales Manager/Officer, Procurement Manager/Officer, Store Manager, Storekeeper, Finance Officer,
System Administrator, Read-Only Auditor). Permissions and approval limits are editable under
**Administration → Roles & permissions**.

## 9. Features, limitations and next steps

See [`docs/FEATURES.md`](docs/FEATURES.md).
