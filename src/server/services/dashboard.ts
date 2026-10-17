/**
 * Executive dashboard metrics — every figure is computed from live database
 * records. Revenue is only "confirmed" when backed by posted sales invoices;
 * order intake and quotation pipeline are reported separately and labelled.
 * No profit figure is reported (no general ledger / full cost data).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { requirePerm, can, type Ctx } from "../context";
import { D, ZERO, round2 } from "@/lib/decimal";

export interface DashboardFilter {
  from: Date;
  to: Date;
  customerId?: string;
  supplierId?: string;
  categoryId?: string;
}

const n = (v: unknown) => Number(v ?? 0);
const LOCAL = Prisma.sql`'Asia/Qatar'`;
/** Converts a stored UTC timestamp column into Qatar local time for grouping. */
const local = (col: Prisma.Sql) => Prisma.sql`((${col}) AT TIME ZONE 'UTC' AT TIME ZONE ${LOCAL})`;

export async function getKpis(ctx: Ctx, f: DashboardFilter) {
  requirePerm(ctx, "dashboard.executive");
  const settings = await prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } });
  const financial = settings.financeEnabled && can(ctx, "dashboard.financial");
  const cust = f.customerId ? Prisma.sql`AND "customerId" = ${f.customerId}` : Prisma.empty;
  const supp = f.supplierId ? Prisma.sql`AND "supplierId" = ${f.supplierId}` : Prisma.empty;

  const [revenue] = await prisma.$queryRaw<{ v: unknown; c: unknown }[]>`
    SELECT COALESCE(SUM(subtotal * "exchangeRate"), 0) v, COUNT(*) c FROM "SalesInvoice"
    WHERE status IN ('POSTED','PARTIALLY_PAID','PAID') AND date >= ${f.from} AND date <= ${f.to} ${cust}`;
  const [intake] = await prisma.$queryRaw<{ v: unknown; c: unknown }[]>`
    SELECT COALESCE(SUM((subtotal - "discountTotal") * "exchangeRate"), 0) v, COUNT(*) c FROM "SalesOrder"
    WHERE status IN ('APPROVED','PARTIALLY_DELIVERED','DELIVERED','CLOSED') AND date >= ${f.from} AND date <= ${f.to} ${cust}`;
  const [delivered] = await prisma.$queryRaw<{ v: unknown }[]>`
    SELECT COALESCE(SUM(dl.quantity * sol."unitPrice" * (1 - sol."discountPct"/100) * so."exchangeRate"), 0) v
    FROM "DeliveryOrderLine" dl JOIN "DeliveryOrder" d ON d.id = dl."deliveryId"
    JOIN "SalesOrderLine" sol ON sol.id = dl."salesOrderLineId" JOIN "SalesOrder" so ON so.id = d."salesOrderId"
    WHERE d.status = 'POSTED' AND d.date >= ${f.from} AND d.date <= ${f.to} ${f.customerId ? Prisma.sql`AND d."customerId" = ${f.customerId}` : Prisma.empty}`;
  const [pipeline] = await prisma.$queryRaw<{ v: unknown; c: unknown }[]>`
    SELECT COALESCE(SUM((subtotal - "discountTotal") * "exchangeRate"), 0) v, COUNT(*) c FROM "SalesQuotation"
    WHERE status IN ('SUBMITTED','APPROVED','SENT','ACCEPTED') ${cust}`;
  const [purchases] = await prisma.$queryRaw<{ v: unknown; c: unknown }[]>`
    SELECT COALESCE(SUM((subtotal - "discountTotal") * "exchangeRate"), 0) v, COUNT(*) c FROM "PurchaseOrder"
    WHERE status IN ('APPROVED','PARTIALLY_RECEIVED','RECEIVED','CLOSED') AND date >= ${f.from} AND date <= ${f.to} ${supp}`;

  const [soAwaiting, poAwaitingApproval, poAwaitingDelivery, poOverdue] = await Promise.all([
    prisma.salesOrder.count({ where: { status: { in: ["SUBMITTED", "APPROVED", "PARTIALLY_DELIVERED"] }, ...(f.customerId ? { customerId: f.customerId } : {}) } }),
    prisma.purchaseOrder.count({ where: { status: "SUBMITTED", ...(f.supplierId ? { supplierId: f.supplierId } : {}) } }),
    prisma.purchaseOrder.count({ where: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] }, ...(f.supplierId ? { supplierId: f.supplierId } : {}) } }),
    prisma.purchaseOrder.count({ where: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] }, expectedDate: { lt: new Date() }, ...(f.supplierId ? { supplierId: f.supplierId } : {}) } }),
  ]);

  const stock = await inventoryStatus(f.categoryId);
  const approvals = await pendingApprovalCounts();

  let finance: null | { receivables: number; payables: number; overdueCount: number; overdueAmount: number } = null;
  if (financial) {
    const [ar] = await prisma.$queryRaw<{ v: unknown }[]>`
      SELECT COALESCE(SUM((total - "paidAmount") * "exchangeRate"), 0) v FROM "SalesInvoice" WHERE status IN ('POSTED','PARTIALLY_PAID') ${cust}`;
    const [ap] = await prisma.$queryRaw<{ v: unknown }[]>`
      SELECT COALESCE(SUM((total - "paidAmount") * "exchangeRate"), 0) v FROM "PurchaseInvoice" WHERE status IN ('POSTED','PARTIALLY_PAID') ${supp}`;
    const [od] = await prisma.$queryRaw<{ v: unknown; c: unknown }[]>`
      SELECT COALESCE(SUM((total - "paidAmount") * "exchangeRate"), 0) v, COUNT(*) c FROM "SalesInvoice"
      WHERE status IN ('POSTED','PARTIALLY_PAID') AND "dueDate" < NOW() ${cust}`;
    finance = { receivables: n(ar.v), payables: n(ap.v), overdueCount: n(od.c), overdueAmount: n(od.v) };
  }

  return {
    financeEnabled: settings.financeEnabled,
    financialVisible: financial,
    confirmedRevenue: { value: n(revenue.v), count: n(revenue.c) },
    orderIntake: { value: n(intake.v), count: n(intake.c) },
    deliveredValue: n(delivered.v),
    quotationPipeline: { value: n(pipeline.v), count: n(pipeline.c) },
    purchases: { value: n(purchases.v), count: n(purchases.c) },
    soAwaiting, poAwaitingApproval, poAwaitingDelivery, poOverdue,
    inventoryValue: stock.value, lowStock: stock.low, outOfStock: stock.out, stockedItems: stock.items,
    pendingApprovals: approvals.total, approvals,
    finance,
  };
}

/** Inventory valuation (on hand × weighted-average cost) and stock-level counts. */
export async function inventoryStatus(categoryId?: string) {
  const items = await prisma.item.findMany({
    where: { active: true, inventoryClass: { not: "NON_STOCK" }, itemType: { not: "SERVICE" }, ...(categoryId ? { categoryId } : {}) },
    select: { id: true, minStockLevel: true, avgCost: true },
  });
  const bal = await prisma.stockBalance.groupBy({ by: ["itemId"], where: { itemId: { in: items.map((i) => i.id) } }, _sum: { quantity: true } });
  const m = new Map(bal.map((b) => [b.itemId, D(b._sum.quantity)]));
  let value = ZERO, low = 0, out = 0;
  for (const it of items) {
    const q = m.get(it.id) ?? ZERO;
    value = value.add(q.mul(D(it.avgCost)));
    // Only items meant to be stocked (minimum level set) count as out / low.
    if (D(it.minStockLevel).lte(0)) continue;
    if (q.lte(0)) out++;
    else if (q.lte(it.minStockLevel)) low++;
  }
  return { value: round2(value).toNumber(), low, out, items: items.length };
}

export async function pendingApprovalCounts() {
  const [quotations, salesOrders, purchaseRequests, purchaseOrders, stockAdjustments] = await Promise.all([
    prisma.salesQuotation.count({ where: { status: "SUBMITTED" } }),
    prisma.salesOrder.count({ where: { status: "SUBMITTED" } }),
    prisma.purchaseRequest.count({ where: { status: "SUBMITTED" } }),
    prisma.purchaseOrder.count({ where: { status: "SUBMITTED" } }),
    prisma.stockDocument.count({ where: { status: { in: ["DRAFT", "SUBMITTED"] }, type: { in: ["ADJUSTMENT", "OPENING"] } } }),
  ]);
  return { quotations, salesOrders, purchaseRequests, purchaseOrders, stockAdjustments, total: quotations + salesOrders + purchaseRequests + purchaseOrders + stockAdjustments };
}

export async function getCharts(ctx: Ctx, f: DashboardFilter) {
  requirePerm(ctx, "dashboard.executive");
  const cust = f.customerId ? Prisma.sql`AND "customerId" = ${f.customerId}` : Prisma.empty;
  const supp = f.supplierId ? Prisma.sql`AND "supplierId" = ${f.supplierId}` : Prisma.empty;
  const month = (col: Prisma.Sql) => Prisma.sql`to_char(date_trunc('month', ${local(col)}), 'YYYY-MM')`;

  const [invByMonth, soByMonth, poByMonth] = await Promise.all([
    prisma.$queryRaw<{ m: string; v: unknown }[]>`
      SELECT ${month(Prisma.sql`date`)} m, SUM(subtotal * "exchangeRate") v FROM "SalesInvoice"
      WHERE status IN ('POSTED','PARTIALLY_PAID','PAID') AND date >= ${f.from} AND date <= ${f.to} ${cust} GROUP BY 1`,
    prisma.$queryRaw<{ m: string; v: unknown }[]>`
      SELECT ${month(Prisma.sql`date`)} m, SUM((subtotal - "discountTotal") * "exchangeRate") v FROM "SalesOrder"
      WHERE status IN ('APPROVED','PARTIALLY_DELIVERED','DELIVERED','CLOSED') AND date >= ${f.from} AND date <= ${f.to} ${cust} GROUP BY 1`,
    prisma.$queryRaw<{ m: string; v: unknown }[]>`
      SELECT ${month(Prisma.sql`date`)} m, SUM((subtotal - "discountTotal") * "exchangeRate") v FROM "PurchaseOrder"
      WHERE status IN ('APPROVED','PARTIALLY_RECEIVED','RECEIVED','CLOSED') AND date >= ${f.from} AND date <= ${f.to} ${supp} GROUP BY 1`,
  ]);
  const months: string[] = [];
  const cur = new Date(Date.UTC(f.from.getUTCFullYear(), f.from.getUTCMonth(), 1));
  while (cur <= f.to && months.length < 36) {
    months.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  const pick = (rows: { m: string; v: unknown }[], m: string) => Math.round(n(rows.find((r) => r.m === m)?.v));
  const monthly = months.map((m) => ({ month: m, invoiced: pick(invByMonth, m), orders: pick(soByMonth, m), purchases: pick(poByMonth, m) }));

  const salesByCustomer = await prisma.$queryRaw<{ id: string; name: string; v: unknown }[]>`
    SELECT c.id, c."legalName" name, SUM((so.subtotal - so."discountTotal") * so."exchangeRate") v
    FROM "SalesOrder" so JOIN "Customer" c ON c.id = so."customerId"
    WHERE so.status IN ('APPROVED','PARTIALLY_DELIVERED','DELIVERED','CLOSED') AND so.date >= ${f.from} AND so.date <= ${f.to}
    ${f.customerId ? Prisma.sql`AND so."customerId" = ${f.customerId}` : Prisma.empty}
    GROUP BY c.id, c."legalName" ORDER BY v DESC LIMIT 8`;
  const purchasesBySupplier = await prisma.$queryRaw<{ id: string; name: string; v: unknown }[]>`
    SELECT s.id, s."legalName" name, SUM((po.subtotal - po."discountTotal") * po."exchangeRate") v
    FROM "PurchaseOrder" po JOIN "Supplier" s ON s.id = po."supplierId"
    WHERE po.status IN ('APPROVED','PARTIALLY_RECEIVED','RECEIVED','CLOSED') AND po.date >= ${f.from} AND po.date <= ${f.to}
    ${f.supplierId ? Prisma.sql`AND po."supplierId" = ${f.supplierId}` : Prisma.empty}
    GROUP BY s.id, s."legalName" ORDER BY v DESC LIMIT 8`;
  const inventoryByCategory = await prisma.$queryRaw<{ id: string | null; name: string | null; v: unknown }[]>`
    SELECT cat.id, COALESCE(cat.name, 'Uncategorised') name, SUM(b.quantity * i."avgCost") v
    FROM "StockBalance" b JOIN "Item" i ON i.id = b."itemId" LEFT JOIN "ItemCategory" cat ON cat.id = i."categoryId"
    ${f.categoryId ? Prisma.sql`WHERE i."categoryId" = ${f.categoryId}` : Prisma.empty}
    GROUP BY cat.id, cat.name HAVING SUM(b.quantity * i."avgCost") <> 0 ORDER BY v DESC`;
  const movements = await prisma.$queryRaw<{ m: string; inv: unknown; outv: unknown }[]>`
    SELECT ${month(Prisma.sql`t."txnDate"`)} m,
      SUM(CASE WHEN t.quantity > 0 AND t.type NOT IN ('TRANSFER_IN','OPENING') THEN t."totalValue" ELSE 0 END) inv,
      SUM(CASE WHEN t.quantity < 0 AND t.type NOT IN ('TRANSFER_OUT') THEN -t."totalValue" ELSE 0 END) outv
    FROM "InventoryTransaction" t JOIN "Item" i ON i.id = t."itemId"
    WHERE t."txnDate" >= ${f.from} AND t."txnDate" <= ${f.to} ${f.categoryId ? Prisma.sql`AND i."categoryId" = ${f.categoryId}` : Prisma.empty}
    GROUP BY 1`;
  const stockMovement = months.map((m) => {
    const r = movements.find((x) => x.m === m);
    return { month: m, inbound: Math.round(n(r?.inv)), outbound: Math.round(n(r?.outv)) };
  });
  const topProducts = await prisma.$queryRaw<{ id: string; code: string; name: string; qty: unknown; v: unknown }[]>`
    SELECT i.id, i.code, i.name, SUM(dl.quantity) qty, SUM(dl.quantity * sol."unitPrice" * (1 - sol."discountPct"/100) * so."exchangeRate") v
    FROM "DeliveryOrderLine" dl JOIN "DeliveryOrder" d ON d.id = dl."deliveryId"
    JOIN "SalesOrderLine" sol ON sol.id = dl."salesOrderLineId" JOIN "SalesOrder" so ON so.id = d."salesOrderId"
    JOIN "Item" i ON i.id = dl."itemId"
    WHERE d.status = 'POSTED' AND d.date >= ${f.from} AND d.date <= ${f.to}
    ${f.customerId ? Prisma.sql`AND d."customerId" = ${f.customerId}` : Prisma.empty}
    ${f.categoryId ? Prisma.sql`AND i."categoryId" = ${f.categoryId}` : Prisma.empty}
    GROUP BY i.id, i.code, i.name ORDER BY v DESC LIMIT 8`;

  return {
    monthly,
    salesByCustomer: salesByCustomer.map((r) => ({ id: r.id, name: r.name, value: Math.round(n(r.v)) })),
    purchasesBySupplier: purchasesBySupplier.map((r) => ({ id: r.id, name: r.name, value: Math.round(n(r.v)) })),
    inventoryByCategory: inventoryByCategory.map((r) => ({ id: r.id, name: r.name ?? "Uncategorised", value: Math.round(n(r.v)) })),
    stockMovement,
    topProducts: topProducts.map((r) => ({ id: r.id, code: r.code, name: r.name, qty: n(r.qty), value: Math.round(n(r.v)) })),
  };
}

/** Items with stock on hand but no outbound movement in `days` days. */
export async function slowMovingItems(days: number, limit = 10) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.$queryRaw<{ id: string; code: string; name: string; qty: unknown; value: unknown; last_out: Date | null }[]>`
    SELECT i.id, i.code, i.name, SUM(b.quantity) qty, SUM(b.quantity) * i."avgCost" value,
      (SELECT MAX(t."txnDate") FROM "InventoryTransaction" t WHERE t."itemId" = i.id AND t.quantity < 0
        AND t.type IN ('ISSUE_DELIVERY','ISSUE_INTERNAL')) last_out
    FROM "Item" i JOIN "StockBalance" b ON b."itemId" = i.id
    WHERE i.active = true
    GROUP BY i.id HAVING SUM(b.quantity) > 0
      AND COALESCE((SELECT MAX(t."txnDate") FROM "InventoryTransaction" t WHERE t."itemId" = i.id AND t.quantity < 0
        AND t.type IN ('ISSUE_DELIVERY','ISSUE_INTERNAL')), '1900-01-01') < ${since}
    ORDER BY value DESC LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, qty: n(r.qty), value: Math.round(n(r.value)), lastOut: r.last_out, nonMoving: !r.last_out }));
}

export interface Alert {
  severity: "critical" | "warning" | "info";
  category: string;
  message: string;
  href: string;
}

export async function getAlerts(ctx: Ctx): Promise<Alert[]> {
  requirePerm(ctx, "dashboard.executive");
  const alerts: Alert[] = [];
  const settings = await prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } });

  const stocked = await prisma.item.findMany({
    where: { active: true, inventoryClass: { not: "NON_STOCK" }, itemType: { not: "SERVICE" }, minStockLevel: { gt: 0 } },
    select: { id: true, code: true, name: true, minStockLevel: true },
  });
  const bal = await prisma.stockBalance.groupBy({ by: ["itemId"], where: { itemId: { in: stocked.map((s) => s.id) } }, _sum: { quantity: true } });
  const bm = new Map(bal.map((b) => [b.itemId, D(b._sum.quantity)]));
  for (const it of stocked) {
    const q = bm.get(it.id) ?? ZERO;
    if (q.lte(0)) alerts.push({ severity: "critical", category: "Out of stock", message: `${it.code} ${it.name} is out of stock (min ${it.minStockLevel})`, href: `/inventory/items/${it.id}` });
    else if (q.lte(it.minStockLevel)) alerts.push({ severity: "warning", category: "Low stock", message: `${it.code} ${it.name}: ${q} on hand, minimum ${it.minStockLevel}`, href: `/inventory/items/${it.id}` });
  }

  const ap = await pendingApprovalCounts();
  if (ap.total) alerts.push({ severity: "info", category: "Approvals", message: `${ap.total} document(s) awaiting approval`, href: "/approvals" });

  const overduePos = await prisma.purchaseOrder.findMany({
    where: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] }, expectedDate: { lt: new Date() } },
    include: { supplier: { select: { legalName: true } } }, take: 10, orderBy: { expectedDate: "asc" },
  });
  for (const po of overduePos) {
    const days = Math.floor((Date.now() - po.expectedDate!.getTime()) / 86_400_000);
    alerts.push({ severity: days > 14 ? "critical" : "warning", category: "Delayed delivery", message: `${po.number} from ${po.supplier.legalName} is ${days} day(s) late`, href: `/purchasing/orders/${po.id}` });
  }
  const upcoming = await prisma.purchaseOrder.findMany({
    where: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] }, expectedDate: { gte: new Date(), lte: new Date(Date.now() + 7 * 86_400_000) } },
    include: { supplier: { select: { legalName: true } } }, take: 10,
  });
  for (const po of upcoming) alerts.push({ severity: "info", category: "Upcoming delivery", message: `${po.number} from ${po.supplier.legalName} due ${po.expectedDate!.toISOString().slice(0, 10)}`, href: `/purchasing/orders/${po.id}` });

  // Approved sales orders whose undelivered stock lines exceed free + reserved stock.
  const shortRows = await prisma.$queryRaw<{ id: string; number: string; code: string }[]>`
    SELECT DISTINCT so.id, so.number, i.code FROM "SalesOrderLine" l
    JOIN "SalesOrder" so ON so.id = l."orderId" JOIN "Item" i ON i.id = l."itemId"
    WHERE so.status IN ('APPROVED','PARTIALLY_DELIVERED') AND i."inventoryClass" <> 'NON_STOCK' AND i."itemType" <> 'SERVICE'
      AND (l.quantity - l."deliveredQty") > (
        COALESCE((SELECT SUM(b.quantity) FROM "StockBalance" b WHERE b."itemId" = i.id AND b."warehouseId" = so."warehouseId"), 0)
        - COALESCE((SELECT SUM(r.quantity) FROM "StockReservation" r WHERE r."itemId" = i.id AND r."warehouseId" = so."warehouseId" AND r.status = 'ACTIVE' AND r."salesOrderLineId" <> l.id), 0))
    LIMIT 10`;
  for (const r of shortRows) alerts.push({ severity: "warning", category: "Insufficient stock", message: `${r.number}: not enough ${r.code} to fulfil`, href: `/sales/orders/${r.id}` });

  if (settings.financeEnabled && can(ctx, "dashboard.financial")) {
    const overdue = await prisma.salesInvoice.findMany({
      where: { status: { in: ["POSTED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } },
      include: { customer: { select: { legalName: true } } }, take: 10, orderBy: { dueDate: "asc" },
    });
    for (const i of overdue) {
      const days = Math.floor((Date.now() - i.dueDate.getTime()) / 86_400_000);
      alerts.push({ severity: days > 30 ? "critical" : "warning", category: "Overdue payment", message: `${i.number} (${i.customer.legalName}) ${days} day(s) overdue — ${i.currency} ${D(i.total).sub(D(i.paidAmount)).toFixed(2)}`, href: `/finance/sales-invoices/${i.id}` });
    }
  }

  const unusual = await prisma.inventoryTransaction.findMany({
    where: {
      type: { in: ["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "COUNT_GAIN", "COUNT_LOSS"] }, txnDate: { gte: new Date(Date.now() - 30 * 86_400_000) },
      OR: [{ quantity: { gte: settings.adjustmentAlertQty } }, { quantity: { lte: D(settings.adjustmentAlertQty).neg() } }],
    },
    include: { item: { select: { code: true } } }, take: 10, orderBy: { txnDate: "desc" },
  });
  for (const t of unusual) alerts.push({ severity: "warning", category: "Unusual adjustment", message: `${t.refDocNo}: ${t.type.replace(/_/g, " ").toLowerCase()} of ${t.quantity} × ${t.item.code}`, href: `/inventory/ledger?q=${encodeURIComponent(t.refDocNo)}` });

  const order = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
