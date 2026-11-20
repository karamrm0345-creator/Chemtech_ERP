# Implemented features, limitations and roadmap

## Implemented

### Platform
- Single PostgreSQL database for all modules (Prisma schema with foreign keys, unique constraints, indexes, migrations).
- Service layer with all business rules; every operation runs in a DB transaction, takes row locks to serialize state changes, and writes an audit log entry.
- Authentication (DB sessions, bcrypt), first-run setup without default passwords, CLI admin creation, change-own-password, login rate limiting.
- Role-based permissions (≈50 granular permissions, 10 editable default roles), approval limits per role and document type, separation of duties.
- Configurable company profile, numbering, currencies (QAR base, multi-currency documents converted at stored rates), tax rate default, business rules (mandatory RFQ/PR stages, receipt tolerance, negative stock, finance on/off).
- Secure attachments on customers, suppliers, items, quotations, orders, deliveries, PRs, RFQs, supplier offers, POs, GRNs and invoices.
- Printable documents (quotation, purchase order, delivery note, GRN, invoice) via browser print / save as PDF.
- Consistent UI: sidebar, header, breadcrumbs, search / filters / sort / pagination in URLs, toasts, confirmation dialogs, loading and error states, responsive layout, English-only interface styled after the reference screenshot.

### Dashboard
- KPIs: confirmed revenue (posted invoices, net of tax), order intake, delivered value, quotation pipeline, purchases, inventory value, open SOs, POs awaiting approval / delivery / overdue, low & out of stock, pending approvals, receivables, overdue invoices, payables, and net profit for the period from the posted general ledger (shown to roles with accounting access).
- Charts: sales vs purchases by month (with table view), sales by customer, purchases by supplier, inventory value by category, stock movement value, top-selling products; slow / non-moving stock table.
- Alerts: out / low stock, approvals waiting, delayed and upcoming supplier deliveries, sales orders with insufficient stock, overdue customer payments, unusual adjustments.
- Filters: period presets or custom range, customer, supplier, category. KPIs and bars link to the underlying records.

### Sales
- Quotations with approval workflow, send / accept / reject, revisions (`-R1`, `-R2` …), validity warnings, conversion to a linked sales order.
- Sales orders with approval, per-line availability (on hand / reserved / available / shortage), reservation and release, short-close, cancellation rules, shortage → purchase request.
- Delivery orders: partial deliveries, FEFO batch allocation or explicit batch, serial capture, rental items marked *rented out*; posting issues stock exactly once and updates fulfilment.
- Service items are delivered and invoiced without stock movements.
- Customer returns against posted deliveries: goods go back into stock (same batch / serials) at the cost they were delivered at; returned quantities are no longer invoiceable.
- Credit notes against posted sales invoices for returned goods or price allowances (never above the invoiced price or quantity); applied to the invoice, any excess kept as customer credit.

### Procurement
- Purchase requests (manual, from low stock, from sales shortage) with approval (optional by setting).
- RFQs to multiple suppliers, supplier quotations in any currency, comparison matrix (QAR-equivalent price, delivery time, payment / delivery terms, technical compliance, weighted criteria scores, per-line prices), selection with justification.
- Purchase orders from PR / selected offer / scratch, freight and other charges, partial-delivery policy, approval limits, short-close, PR ordered-quantity tracking.
- Goods receipts: tolerance check, rejected quantities with reasons (auto-logged as supplier nonconformity), batch / expiry / certificate / serial / bin capture, landed cost (freight allocated by value, converted to QAR), outstanding quantities.
- Returns to supplier; supplier invoices with 3-way match (variance must be justified to post), freight / other charges billed against the PO, and payments through a chosen bank or cash account.
- Debit notes against posted supplier invoices, optionally linked to a purchase return so the returned stock value is cleared exactly (difference to price variance); price allowances without a return.

### Store & inventory
- Item master with types, control classes, manufacturer / part numbers, preferred supplier, min / reorder levels, prices, default warehouse / bin, batch / expiry / serial / hazardous flags; tracking fields locked once stock history exists.
- Immutable ledger with sequence number, reference document, user and balance after; balance cache maintained transactionally; per-item row locks for concurrency; negative stock blocked by default.
- Opening balances and adjustments (approval by a second user within value limit), transfers, internal issues, physical counts (variance against current balance), reversals by compensating entries.
- Stock card per item, stock on hand / valuation, ledger browser, low-stock replenishment, batch & serial traceability.

### Accounting (general ledger)
- Chart of accounts (tree of group and posting accounts, asset / liability / equity / income / expense), seeded with a standard chart for a Qatar trading and oilfield-services company and fully editable; posting accounts (receivables, payables, inventory, GRNI, sales, cost of sales, tax, bank, cash …) can be remapped.
- Double-entry ledger in QAR. Every operational document posts its journal in the same database transaction:
  goods receipt (Dr inventory / Cr GRNI at landed cost), supplier invoice (Dr GRNI at PO price, price variance, freight, input tax / Cr payables),
  delivery (Dr cost of sales / Cr inventory at weighted-average cost), sales invoice (Dr receivables / Cr sales of goods or services, output tax),
  receipts and payments (bank or cash vs receivables / payables, per customer or supplier), opening stock, adjustments, counts, internal issues and returns.
  Transfers move value inside the inventory account; stock reversals reverse their journal.
- Journals must balance, cannot hit group or inactive accounts, and are immutable once posted; corrections are reversing journals.
- Manual journal entries (including opening balances) with draft → post; the preparer cannot post their own journal (separation of duties).
- Fiscal years (calendar year created automatically on first posting, or custom years), books lock date for month-end close, year-end close that moves income and expense to retained earnings, and audited reopen.
- Trial balance, profit & loss, balance sheet (with profit not yet closed), general ledger / account statement with running balance and customer or supplier filter, journal register; every figure drills down to the journal and source document. Accounting-entry panel on invoices, receipts, deliveries and stock documents.
- Receipts and payments per customer / supplier: one payment can settle several invoices (with *allocate oldest first*), any surplus is held on account as an advance and allocated later; credit and debit notes are allocated the same way.
- Foreign-currency settlement: invoices are cleared at their own rate and the difference to the payment rate is posted as a realised exchange difference.
- Withholding tax on supplier payments (rate per supplier, editable per payment): the bank pays the net, the withheld amount goes to *Withholding tax payable*.
- Tax codes map each rate to its output and input tax accounts; cost centres on sales and supplier invoices and journal lines, with profit & loss and ledger filtered by cost centre.
- Reports: customer aging and supplier aging (by days past due, with unallocated credits) and tax summary (output and input tax by rate, net of notes). Revenue figures on the dashboard and sales reports are net of credit notes.
- Refunds: pay back unused customer credit (advance or credit note) or record money a supplier returns; the refunded amount is used up on its source document.
- Period-end foreign-currency revaluation: open foreign-currency receivables, payables and unapplied credits restated at the closing rate (preview first), posted to *Unrealised exchange differences* and reversed automatically the next day.
- Fixed assets: categories with their ledger accounts, asset register (cost, salvage, useful life, depreciation already charged before go-live, serial, location, cost centre), capitalisation against a chosen funding account, monthly straight-line depreciation run (catches up missed months, never charges a month twice, stops at salvage value), disposal with proceeds and gain or loss.
- Budgets per fiscal year and optionally per cost centre: annual amounts per income / expense account spread over the months, budget versus actual for any range of months with favourable / unfavourable variances.
- Bank reconciliation: CSV statement import (Date, Description, Reference, Amount or Debit / Credit; opening + lines must equal closing), automatic matching by amount, date and reference, manual matching, booking of bank-only items (charges, interest) from the statement, the reconciliation proof (books − uncleared entries + unbooked bank items = statement), completion lock, and deletion of a wrongly imported open statement.
- Cash flow statement (direct method): every bank / cash movement classified by the other side of its journal into operating, investing and financing activities (accounts can be marked Investing or Financing), always agreeing with the cash accounts.
- Backfill (`npm run ledger:backfill`, run automatically by Docker start-up) posts journals for documents created before accounting was enabled. Integration tests reconcile the ledger to the stock ledger and to open receivables / payables.

### Customers / suppliers
- Full profiles, contacts, duplicate warnings, transaction history tabs, documents, audit history.
- Supplier certificates with expiry status, prequalification, nonconformities with closure, delivery performance (on-time %, rejection %), restricted bank details.

### Reports (screen + Excel + CSV + print)
Sales by period, sales by customer, sales order status, quotation conversion, purchases by supplier, PO status, supplier delivery performance, stock on hand, stock valuation, low stock, slow-moving, stock ledger, stock adjustments, expiring batches & certificates, pending approvals, audit trail.

## Known limitations

- **ERPNext history import** is not built yet: it needs an export of the ERPNext Chart of Accounts and General Ledger to build and test against.
- Depreciation is straight-line only (no reducing-balance); assets are capitalised individually (no purchase-invoice-to-asset wizard).
- Bank statements are imported from CSV; MT940 / OFX formats and direct bank feeds are not supported.
- Budgets are entered as annual amounts spread evenly by month (monthly amounts can be sent through the service, not yet edited on screen).
- The cash flow statement uses the direct method; an indirect-method reconciliation from profit is not produced.
- Goods returned to a supplier *before* they are invoiced post at average cost against GRNI; a small difference to the receipt cost can remain in GRNI and is cleared with a manual journal. Returns linked to a debit note clear exactly.
- Stock balances are kept per warehouse and lot; bin location is recorded on movements and items but there is no per-bin balance.
- Weighted-average cost is company-wide (not per warehouse); reversals restore quantities at the original cost but do not recompute historical averages.
- Credit limit is displayed and warned about, not enforced as a hard block.
- Exchange rates are maintained manually; rates are frozen on each document at creation.
- Rental equipment is tracked by serial status (*rented out*) but rental periods, returns and rental invoicing are not modelled.
- Login rate limiting and attachment storage are single-instance (see DEPLOYMENT.md for scaling notes).
- Email notifications and sending PDFs to customers / suppliers are not included (print / save as PDF instead).
- English interface only (as requested).

## Suggested next steps

1. ERPNext migration: import the chart of accounts, opening balances and historical journals from an ERPNext export, with reconciliation reports.
2. Customer and supplier statements as printable documents and email.
3. Reducing-balance depreciation, asset creation from supplier invoices, monthly budget editing on screen, MT940 / OFX bank statements.
4. Equipment rental module (rental orders, on-hire / off-hire, inspection and certification schedules, rental invoicing).
5. Email notifications for approvals and alerts; PDF generation server-side for emailing.
6. Per-bin stock balances and barcode / QR scanning for store transactions.
7. Configurable multi-step approval chains (e.g. Procurement Manager → GM above a threshold).
