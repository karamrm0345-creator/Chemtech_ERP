# Operations: backup, restore and integrity

## Backup

Back up **both** the database and the attachment directory.

```bash
# Nightly database backup (custom format, compressed), keep 30 days
pg_dump -h <host> -U chemtech -Fc chemtech_erp > /var/backups/chemtech/db-$(date +%F).dump
find /var/backups/chemtech -name 'db-*.dump' -mtime +30 -delete

# Attachments
tar -czf /var/backups/chemtech/uploads-$(date +%F).tgz -C /var/lib/chemtech uploads
```

Example cron (`crontab -u chemtech -e`):

```
30 1 * * * pg_dump -Fc chemtech_erp > /var/backups/chemtech/db-$(date +\%F).dump
45 1 * * * tar -czf /var/backups/chemtech/uploads-$(date +\%F).tgz -C /var/lib/chemtech uploads
```

Copy backups off-site (another region or provider). Test a restore at least quarterly.

## Restore

```bash
sudo systemctl stop chemtech-erp
dropdb chemtech_erp && createdb -O chemtech chemtech_erp      # ⚠ destroys the current database
pg_restore -d chemtech_erp --no-owner -U chemtech /var/backups/chemtech/db-2026-10-17.dump
tar -xzf /var/backups/chemtech/uploads-2026-10-17.tgz -C /var/lib/chemtech
npx prisma migrate deploy        # brings an older backup up to the current schema
sudo systemctl start chemtech-erp
```

To restore into a separate database for inspection, use `createdb chemtech_erp_restore` and point a
temporary `DATABASE_URL` at it.

## Data integrity checks

The stock ledger (`InventoryTransaction`) is the source of truth; `StockBalance` is a cache kept in
the same transaction. These queries should return **zero rows**:

```sql
-- Balance cache equals ledger sum per item/warehouse
SELECT b."itemId", b."warehouseId", SUM(b.quantity) bal,
       (SELECT COALESCE(SUM(t.quantity),0) FROM "InventoryTransaction" t
         WHERE t."itemId"=b."itemId" AND t."warehouseId"=b."warehouseId") led
FROM "StockBalance" b GROUP BY 1,2 HAVING SUM(b.quantity) <>
  (SELECT COALESCE(SUM(t.quantity),0) FROM "InventoryTransaction" t WHERE t."itemId"=b."itemId" AND t."warehouseId"=b."warehouseId");

-- Negative balances (should not exist unless negative stock was explicitly allowed)
SELECT * FROM "StockBalance" WHERE quantity < 0;

-- PO received quantity equals posted GRN accepted quantity
SELECT l.id, l."receivedQty", COALESCE(SUM(g."acceptedQty"),0) grn
FROM "PurchaseOrderLine" l LEFT JOIN "GoodsReceiptLine" g ON g."poLineId"=l.id
  AND EXISTS (SELECT 1 FROM "GoodsReceipt" r WHERE r.id=g."receiptId" AND r.status='POSTED')
GROUP BY l.id HAVING l."receivedQty" <> COALESCE(SUM(g."acceptedQty"),0);

-- SO delivered quantity equals posted delivery quantity
SELECT l.id, l."deliveredQty", COALESCE(SUM(d.quantity),0) dlv
FROM "SalesOrderLine" l LEFT JOIN "DeliveryOrderLine" d ON d."salesOrderLineId"=l.id
  AND EXISTS (SELECT 1 FROM "DeliveryOrder" o WHERE o.id=d."deliveryId" AND o.status='POSTED')
GROUP BY l.id HAVING l."deliveredQty" <> COALESCE(SUM(d.quantity),0);
```

## Corrections policy

Posted documents are never edited or deleted:

- **Stock documents** (adjustment, opening, transfer, issue): use **Reverse**, which writes compensating ledger rows.
- **Goods received in error**: post a **Return to supplier** against the PO.
- **Wrong delivery quantity**: correct with a stock adjustment (approved), referencing the delivery. A customer-return document is on the roadmap.
- **Sales invoices**: drafts can be cancelled; posted invoices need a credit note (roadmap).

All of these actions are recorded in the audit trail.

## Monitoring

- `systemctl status chemtech-erp`, `journalctl -u chemtech-erp`. Unexpected errors are logged with `[action]` / `[export]` prefixes.
- Watch PostgreSQL disk usage and the attachment volume.
