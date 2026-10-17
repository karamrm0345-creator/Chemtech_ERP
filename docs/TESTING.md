# Testing

## Automated integration tests (Vitest, real PostgreSQL)

`npm test` runs `tests/**/*.test.ts` against the dedicated test database from `.env.test`
(its name must end in `_test`). The suite calls the same service layer the UI uses, with real
users and roles, so permission checks, transactions, row locks and constraints are all exercised.

| # | Required scenario | Test |
|---|---|---|
| 1 | Create a customer and verify it appears in the list | `master-data › [T1]` |
| 2 | Create a supplier and verify it appears in the list | `master-data › [T2]` |
| 3 | Create an item and receive an opening balance through an authorised transaction | `inventory › [T3]` |
| 4 | Sales order stock availability | `sales › [T4]` |
| 5 | Reservation reduces available, not on-hand | `sales › [T5]` |
| 6 | Posted delivery reduces on-hand exactly once | `sales › [T6][T13]` |
| 7 | Purchase order with partial receipt | `purchasing › [T7][T8][T9]` |
| 8 | Received / outstanding quantities correct | `purchasing › [T7][T8][T9]` |
| 9 | Posted GRN increases inventory exactly once | `purchasing › [T7][T8][T9]` |
| 10 | Low-stock alert at the correct threshold | `purchasing › [T10]` |
| 11 | Unauthorised users cannot approve restricted transactions | `sales › [T11]`, `purchasing › [T11]` |
| 12 | Dashboard figures match the database | `dashboard › [T12]` |
| 13 | Duplicate submissions do not duplicate receipts / movements | `sales › [T6][T13]`, `purchasing › [T13]` |
| 14 | Concurrent stock transactions stay consistent | `concurrency › [T14]` (×2) |

Additional coverage: duplicate customer warnings, bank-detail masking and edit protection,
separation of duties and approval value limits (sales, purchasing, adjustments), negative-stock
prevention, transfers and reversals, FEFO batch allocation and expiry enforcement, serial numbers,
physical counts, the ledger-equals-balance invariant, service items without stock movements,
partial delivery and over-delivery prevention, reservations protected from other orders,
shortage → purchase request, the full PR → RFQ → comparison → PO chain, over-receipt tolerance,
rejected quantities → NCR, partial-delivery policy, landed cost, returns to supplier, invoicing
only after delivery, over-payment prevention, 3-way match variance, cancellation rules,
concurrent document numbering, every report running, and report permissions.

### Latest result

```
 Test Files  7 passed (7)
      Tests  47 passed (47)
```

(run on 2026-10-17, PostgreSQL 16, Node 22)

## Browser end-to-end test (Playwright)

`e2e/sales-workflow.spec.ts` drives the real UI: a sales officer creates and submits an order, the
officer cannot approve, the sales manager approves, the storekeeper creates and posts the delivery,
and the item's on-hand quantity drops by exactly the delivered amount. It also checks the
unauthenticated redirect and that a storekeeper is refused admin pages.

```bash
ALLOW_DEMO_SEED=1 DEMO_PASSWORD='…' npm run db:seed:demo   # dev database only
npm run dev
E2E_PASSWORD='…' CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

## Page smoke test

`scripts/crawl-pages.mjs` signs in as a given user and opens every page type: lists, a sample of
detail pages for each record type, every form, every tab and every report. It reports HTTP errors,
error boundaries, browser exceptions or "not found" pages, and counts pages refused by role.

```bash
node scripts/crawl-pages.mjs gm@chemtech.demo '<password>'
```

## Responsive check

Pages were rendered at desktop (1280–1440 px) and phone width (390 px) with Playwright and
inspected. The sidebar collapses into a drawer, KPI cards and charts stack, and tables scroll horizontally on small screens.

## Latest browser results (2026-10-17, demo data)

| Run | Result |
|---|---|
| Page crawl, dev server: General Manager | 106 pages, 0 problems (pages outside the role correctly refused) |
| Page crawl, dev server: System Administrator | 106 pages, 0 problems |
| Page crawl, dev server: Storekeeper | 106 pages, 0 problems |
| Page crawl, **production build**: General Manager | 106 pages, 0 problems |
| Page crawl, **production build**: Sales Officer | 106 pages, 0 problems |
| Playwright e2e, dev and production builds | 2 passed |
| `npm run build` / `tsc --noEmit` / `eslint` | clean |
