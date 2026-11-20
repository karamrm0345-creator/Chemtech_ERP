# System administrator guide

## First steps

1. Create the first administrator via `/setup` or `npm run admin:create`.
2. **Administration → Company settings**:
   - company profile (shown on printed documents); upload the logo under *Company logo & documents*;
   - business rules: finance on/off, negative stock, receipt tolerance %, mandatory RFQ / PR stages, slow-moving threshold, unusual-adjustment threshold;
   - document numbering (prefix, padding, yearly reset), currencies and exchange rates (QAR base), supplier evaluation criteria and weights.
3. **Store & inventory → Warehouses & setup**: warehouses, bin locations, categories, units of measure.
4. **Administration → Users**: create an account for each person and assign a role. Give each user a temporary password; they change it under the user menu → *Change password*.
5. Load master data (customers, suppliers, items), then post **opening balances** (Stock documents → Adjustment / opening → type *Opening*). These need approval by a second user.

## Roles

| Role | Typical scope |
|---|---|
| General Manager | Executive dashboard, financial KPIs, all approvals (unlimited by default), posts journals, closes periods, read access everywhere |
| Sales Manager | Customers, quotations, orders; approves up to QAR 500,000 |
| Sales Officer | Prepares quotations, orders, deliveries; cannot approve |
| Procurement Manager | Suppliers, PR/RFQ/PO; approves up to QAR 250,000; sees bank details |
| Procurement Officer | Prepares PRs, RFQs, POs; cannot approve |
| Store Manager | Items, warehouses, receipts, deliveries, counts; approves adjustments up to QAR 20,000 |
| Storekeeper | Records receipts, deliveries, transfers, issues, counts; cannot alter posted history |
| Finance Officer | Invoices, receipts, supplier payments, chart of accounts, prepares and posts journals (not their own); sees bank details |
| System Administrator | Users, roles, settings, audit; **no business approvals** |
| Read-Only Auditor | Read access including audit trail and exports |

Roles are fully editable under **Roles & permissions**: permission checkboxes plus approval limits per
document type (QAR). Rules enforced on the server for every action:

- a user needs the specific permission (e.g. `purchase.order.approve`);
- **separation of duties**: nobody can approve a document they prepared;
- the document value (converted to QAR) must be within the role's limit; no limit row means no cap.

Changing a user's role, deactivating them or resetting their password signs out their sessions.

## Accounting

- **Chart of accounts** (Accounting → Chart of accounts): add accounts under the right group; group accounts only total their sub-accounts.
  Type and group flag lock once an account has postings. Mark bank and cash accounts as *Bank / cash* so they can be chosen on payments.
- **Posting accounts** (same page): where invoices, payments and stock movements post. Change them before go-live, not mid-year.
- **Manual journals**: a Finance Officer prepares the draft; another user with *Post and reverse manual journal entries* posts it.
  Posted journals cannot be edited; use *Reverse*. Documents (invoices, receipts, stock) reverse through their own workflow.
- **Month-end**: review the trial balance, then set the **books lock date** (Accounting → Fiscal years) so nothing more is posted in that month.
- **Year-end**: post or cancel draft journals dated in the year, review the trial balance and P&L, then *Close year*.
  Closing books income and expense to retained earnings and locks the year. *Reopen* (latest closed year only) reverses the closing entry and is audited.
- **Existing data**: on upgrade, `npm run ledger:backfill` (run automatically by the Docker start-up) posts journals for documents created
  before accounting was enabled. It is safe to re-run.
- Permissions added in this release are granted once to the default roles that include them; changes you made to roles are kept.

## Security notes

- Passwords: bcrypt (cost 12), minimum 10 characters with letters and numbers.
- Sessions: random 256-bit token in an httpOnly, SameSite=Lax cookie (Secure in production); only a SHA-256 hash is stored; 12-hour lifetime.
- Login: 5 failed attempts per email+IP per 15 minutes; failures are audited.
- Server actions are protected by Next.js origin checks (CSRF); every action re-validates the session and permission.
- Attachments: PDF / images / Office / CSV / text, max 10 MB, content sniffing, random file names outside the web root, downloads re-check the permission of the owning record.
- Supplier bank details are masked for roles without `supplier.bank.view` and can only be changed with `supplier.bank.manage` (changes are audited, values masked in the log).
- CSV exports neutralise spreadsheet formula injection.

## Audit trail

**Administration → Audit trail** lists every create/update/approve/post/cancel/reverse/export/login,
with the user, time, IP and before/after values. Filter by entity, date or text, and export from
*Reports → Audit trail*.
