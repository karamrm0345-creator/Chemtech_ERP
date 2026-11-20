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

Accounting (`tests/accounting.test.ts`): journals for every step of the sales cycle (delivery at cost, invoice with tax,
receipt) and purchase cycle (receipt at landed cost, supplier invoice clearing GRNI with price variance and freight, payment);
inventory account equal to the stock ledger through transfers, adjustments and reversals; customer and supplier statements
netting to zero; balanced trial balance and balance sheet; manual journals (balance check, separation of duties, group
accounts refused, reversal); accounting permissions; books lock date; fiscal-year close into retained earnings and reopen;
and a backfill + reconciliation of the whole database (ledger = stock ledger, receivables and payables = open invoices less
unallocated credits).

Accounting phase 2 (`tests/accounting-phase2.test.ts`): one receipt settling two invoices with the surplus held on account and
allocated later (over-allocation and wrong-customer allocation refused); realised exchange difference on a USD invoice paid at
another rate; supplier payment with 5 % withholding tax; customer return at issue cost limiting invoicing, credit note against
the invoice (quantity and price limits, double posting refused), credit left on account and applied to another invoice; debit
note for a purchase return clearing GRNI with the cost difference to variance; tax code accounts and cost-centre P&L; and the
reconciliation and new aging / tax reports.

Accounting phase 3 (`tests/accounting-phase3.test.ts`): customer and supplier refunds (limits, permissions, party balances);
period-end revaluation of a USD receivable with automatic reversal and duplicate-date protection; fixed asset capitalisation,
depreciation catch-up, no double charge, disposal blocked until depreciation is up to date, gain on disposal; budget versus actual
for a cost centre; bank statement CSV import with balance check, auto-matching, uncleared cheque, booking a bank fee, completion and
duplicate-import protection; deleting a mis-imported statement with reversal; and a cash flow statement that agrees with the cash accounts.

### Latest result

```
 Test Files  10 passed (10)
      Tests  69 passed (69)
```

(run on 2026-11-20, PostgreSQL 16, Node 22)

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

## Latest browser results (2026-11-20, demo data, production build)

| Run | Result |
|---|---|
| Page crawl: General Manager, Finance Officer, Read-Only Auditor, Storekeeper, Sales Officer | 151 pages each, 0 problems (pages outside each role correctly refused) |
| Asset registered, capitalised and depreciated; budget with budget vs actual; bank statement imported from CSV, auto-matched, fee booked, reconciled; refund; FX revaluation preview; cash flow | passed |
| Manual journal prepared by Finance, posted by GM; statements reviewed | passed |
| Receipt allocated oldest-first with advance; supplier payment with 5 % withholding; credit note; debit note; customer return; cost centre; aging and tax reports | passed |
| Playwright e2e (sales workflow, access control) | 2 passed |
| `npm run build` / `tsc --noEmit` / `eslint` | clean |

## Earlier browser results (2026-10-17, demo data)

| Run | Result |
|---|---|
| Page crawl, dev server: General Manager | 106 pages, 0 problems (pages outside the role correctly refused) |
| Page crawl, dev server: System Administrator | 106 pages, 0 problems |
| Page crawl, dev server: Storekeeper | 106 pages, 0 problems |
| Page crawl, **production build**: General Manager | 106 pages, 0 problems |
| Page crawl, **production build**: Sales Officer | 106 pages, 0 problems |
| Playwright e2e, dev and production builds | 2 passed |
| `npm run build` / `tsc --noEmit` / `eslint` | clean |
