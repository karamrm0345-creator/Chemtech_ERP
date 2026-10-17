/**
 * Report registry. Each report declares its permission, filters and a run()
 * that queries live data. The same definition powers the on-screen table,
 * CSV/Excel export and the print view, so they always agree.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { requirePerm, type Ctx } from "../context";
import type { Permission } from "../auth/permissions";
import { D, round2 } from "@/lib/decimal";
import { stockOnHandReport } from "./inventory";
import { lowStockSuggestions } from "./purchasing";
import { slowMovingItems } from "./dashboard";

export type ColType = "text" | "money" | "qty" | "date" | "datetime" | "pct" | "int";
export interface Column { key: string; label: string; type?: ColType }
export type FilterKind = "dateRange" | "customer" | "supplier" | "warehouse" | "category" | "status" | "days" | "text";
export interface ReportFilter { kind: FilterKind; options?: string[] }
export interface ReportParams {
  from?: Date; to?: Date; customerId?: string; supplierId?: string; warehouseId?: string; categoryId?: string;
  status?: string; days?: number; q?: string;
}
export interface ReportResult { columns: Column[]; rows: Record<string, unknown>[]; totals?: Record<string, number>; note?: string }
export interface ReportDef {
  key: string; title: string; group: "Sales" | "Procurement" | "Inventory" | "Control"; description: string;
  permission: Permission; filters: ReportFilter[]; run: (p: ReportParams, ctx: Ctx) => Promise<ReportResult>;
}

const n = (v: unknown) => Number(v ?? 0);
const range = (p: ReportParams, col: string) => {
  const parts: Prisma.Sql[] = [];
  if (p.from) parts.push(Prisma.sql`${Prisma.raw(col)} >= ${p.from}`);
  if (p.to) parts.push(Prisma.sql`${Prisma.raw(col)} <= ${p.to}`);
  return parts.length ? Prisma.sql`AND ${Prisma.join(parts, " AND ")}` : Prisma.empty;
};
const sum = (rows: Record<string, unknown>[], ...keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, Math.round(rows.reduce((s, r) => s + n(r[k]), 0) * 100) / 100]));
const SO_CONFIRMED = Prisma.sql`('APPROVED','PARTIALLY_DELIVERED','DELIVERED','CLOSED')`;
const PO_CONFIRMED = Prisma.sql`('APPROVED','PARTIALLY_RECEIVED','RECEIVED','CLOSED')`;

export const REPORTS: ReportDef[] = [
  {
    key: "sales-by-period", title: "Sales by period", group: "Sales", permission: "reports.view",
    description: "Monthly approved order intake, delivered value and posted invoice revenue (base currency).",
    filters: [{ kind: "dateRange" }, { kind: "customer" }],
    async run(p) {
      const cust = p.customerId ? Prisma.sql`AND "customerId" = ${p.customerId}` : Prisma.empty;
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        WITH so AS (SELECT to_char(date_trunc('month', date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Qatar'), 'YYYY-MM') m,
            SUM((subtotal - "discountTotal") * "exchangeRate") v, COUNT(*) c FROM "SalesOrder"
            WHERE status IN ${SO_CONFIRMED} ${range(p, "date")} ${cust} GROUP BY 1),
        inv AS (SELECT to_char(date_trunc('month', date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Qatar'), 'YYYY-MM') m,
            SUM(subtotal * "exchangeRate") v FROM "SalesInvoice"
            WHERE status IN ('POSTED','PARTIALLY_PAID','PAID') ${range(p, "date")} ${cust} GROUP BY 1)
        SELECT COALESCE(so.m, inv.m) month, COALESCE(so.c, 0)::int orders, COALESCE(so.v, 0)::float "orderIntake", COALESCE(inv.v, 0)::float revenue
        FROM so FULL OUTER JOIN inv ON so.m = inv.m ORDER BY 1`;
      return {
        columns: [{ key: "month", label: "Month" }, { key: "orders", label: "Orders", type: "int" }, { key: "orderIntake", label: "Order intake (QAR)", type: "money" }, { key: "revenue", label: "Invoiced revenue (QAR)", type: "money" }],
        rows, totals: sum(rows, "orders", "orderIntake", "revenue"),
        note: "Order intake = approved sales orders (not revenue). Revenue = posted sales invoices, net of tax.",
      };
    },
  },
  {
    key: "sales-by-customer", title: "Sales by customer", group: "Sales", permission: "reports.view",
    description: "Approved order value, delivered value and invoiced revenue per customer.",
    filters: [{ kind: "dateRange" }],
    async run(p) {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT c.code, c."legalName" customer, c.category,
          COALESCE((SELECT COUNT(*) FROM "SalesOrder" so WHERE so."customerId" = c.id AND so.status IN ${SO_CONFIRMED} ${range(p, "so.date")}), 0)::int orders,
          COALESCE((SELECT SUM((so.subtotal - so."discountTotal") * so."exchangeRate") FROM "SalesOrder" so WHERE so."customerId" = c.id AND so.status IN ${SO_CONFIRMED} ${range(p, "so.date")}), 0)::float "orderIntake",
          COALESCE((SELECT SUM(i.subtotal * i."exchangeRate") FROM "SalesInvoice" i WHERE i."customerId" = c.id AND i.status IN ('POSTED','PARTIALLY_PAID','PAID') ${range(p, "i.date")}), 0)::float revenue,
          COALESCE((SELECT SUM((i.total - i."paidAmount") * i."exchangeRate") FROM "SalesInvoice" i WHERE i."customerId" = c.id AND i.status IN ('POSTED','PARTIALLY_PAID')), 0)::float outstanding
        FROM "Customer" c ORDER BY "orderIntake" DESC`;
      const filtered = rows.filter((r) => n(r.orders) > 0 || n(r.revenue) > 0 || n(r.outstanding) > 0);
      return {
        columns: [{ key: "code", label: "Code" }, { key: "customer", label: "Customer" }, { key: "category", label: "Category" }, { key: "orders", label: "Orders", type: "int" }, { key: "orderIntake", label: "Order intake (QAR)", type: "money" }, { key: "revenue", label: "Invoiced (QAR)", type: "money" }, { key: "outstanding", label: "Outstanding (QAR)", type: "money" }],
        rows: filtered, totals: sum(filtered, "orders", "orderIntake", "revenue", "outstanding"),
      };
    },
  },
  {
    key: "sales-order-status", title: "Sales order status", group: "Sales", permission: "reports.view",
    description: "Every sales order with fulfilment progress.",
    filters: [{ kind: "dateRange" }, { kind: "customer" }, { kind: "status", options: ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED", "CANCELLED"] }],
    async run(p) {
      const orders = await prisma.salesOrder.findMany({
        where: {
          ...(p.customerId ? { customerId: p.customerId } : {}), ...(p.status ? { status: p.status as never } : {}),
          ...(p.from || p.to ? { date: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {}),
        },
        include: { customer: true, lines: true }, orderBy: { date: "desc" }, take: 5000,
      });
      const rows = orders.map((o) => {
        const ordered = o.lines.reduce((s, l) => s + n(l.quantity), 0);
        const delivered = o.lines.reduce((s, l) => s + n(l.deliveredQty), 0);
        return {
          number: o.number, date: o.date, customer: o.customer.legalName, status: o.status, requiredDate: o.requiredDate,
          currency: o.currency, total: n(o.total), fulfilled: ordered ? Math.round((delivered / ordered) * 1000) / 10 : 0,
        };
      });
      return {
        columns: [{ key: "number", label: "Order" }, { key: "date", label: "Date", type: "date" }, { key: "customer", label: "Customer" }, { key: "status", label: "Status" }, { key: "requiredDate", label: "Required", type: "date" }, { key: "currency", label: "Cur." }, { key: "total", label: "Total", type: "money" }, { key: "fulfilled", label: "Delivered %", type: "pct" }],
        rows,
      };
    },
  },
  {
    key: "quotation-conversion", title: "Quotation conversion rate", group: "Sales", permission: "reports.view",
    description: "Quotations issued vs won (converted/accepted) and lost, by month.",
    filters: [{ kind: "dateRange" }, { kind: "customer" }],
    async run(p) {
      const cust = p.customerId ? Prisma.sql`AND "customerId" = ${p.customerId}` : Prisma.empty;
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT to_char(date_trunc('month', date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Qatar'), 'YYYY-MM') month,
          COUNT(*) FILTER (WHERE status NOT IN ('DRAFT','CANCELLED','REVISED'))::int issued,
          COUNT(*) FILTER (WHERE status IN ('ACCEPTED','CONVERTED'))::int won,
          COUNT(*) FILTER (WHERE status = 'REJECTED')::int lost,
          COALESCE(SUM((subtotal - "discountTotal") * "exchangeRate") FILTER (WHERE status NOT IN ('DRAFT','CANCELLED','REVISED')), 0)::float "issuedValue",
          COALESCE(SUM((subtotal - "discountTotal") * "exchangeRate") FILTER (WHERE status IN ('ACCEPTED','CONVERTED')), 0)::float "wonValue"
        FROM "SalesQuotation" WHERE true ${range(p, "date")} ${cust} GROUP BY 1 ORDER BY 1`;
      const withRate = rows.map((r) => ({ ...r, rate: n(r.issued) ? Math.round((n(r.won) / n(r.issued)) * 1000) / 10 : 0 }));
      const t = sum(withRate, "issued", "won", "lost", "issuedValue", "wonValue");
      return {
        columns: [{ key: "month", label: "Month" }, { key: "issued", label: "Issued", type: "int" }, { key: "won", label: "Won", type: "int" }, { key: "lost", label: "Lost", type: "int" }, { key: "rate", label: "Conversion %", type: "pct" }, { key: "issuedValue", label: "Issued value (QAR)", type: "money" }, { key: "wonValue", label: "Won value (QAR)", type: "money" }],
        rows: withRate, totals: { ...t, rate: t.issued ? Math.round((t.won / t.issued) * 1000) / 10 : 0 },
      };
    },
  },
  {
    key: "purchases-by-supplier", title: "Purchases by supplier", group: "Procurement", permission: "reports.view",
    description: "Approved purchase order value and receipts per supplier.",
    filters: [{ kind: "dateRange" }],
    async run(p) {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT s.code, s."legalName" supplier, s.category, COUNT(po.id)::int orders,
          COALESCE(SUM((po.subtotal - po."discountTotal") * po."exchangeRate"), 0)::float "orderValue",
          COALESCE(SUM(po.freight * po."exchangeRate" + po."otherCharges" * po."exchangeRate"), 0)::float charges
        FROM "PurchaseOrder" po JOIN "Supplier" s ON s.id = po."supplierId"
        WHERE po.status IN ${PO_CONFIRMED} ${range(p, "po.date")}
        GROUP BY s.id ORDER BY "orderValue" DESC`;
      return {
        columns: [{ key: "code", label: "Code" }, { key: "supplier", label: "Supplier" }, { key: "category", label: "Category" }, { key: "orders", label: "POs", type: "int" }, { key: "orderValue", label: "Goods value (QAR)", type: "money" }, { key: "charges", label: "Freight & charges (QAR)", type: "money" }],
        rows, totals: sum(rows, "orders", "orderValue", "charges"),
      };
    },
  },
  {
    key: "purchase-order-status", title: "Purchase order status", group: "Procurement", permission: "reports.view",
    description: "Purchase orders with received / outstanding progress and lateness.",
    filters: [{ kind: "dateRange" }, { kind: "supplier" }, { kind: "status", options: ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED", "REJECTED"] }],
    async run(p) {
      const pos = await prisma.purchaseOrder.findMany({
        where: {
          ...(p.supplierId ? { supplierId: p.supplierId } : {}), ...(p.status ? { status: p.status as never } : {}),
          ...(p.from || p.to ? { date: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {}),
        },
        include: { supplier: true, lines: true }, orderBy: { date: "desc" }, take: 5000,
      });
      const now = Date.now();
      const rows = pos.map((o) => {
        const ordered = o.lines.reduce((s, l) => s + n(l.quantity), 0);
        const received = o.lines.reduce((s, l) => s + n(l.receivedQty) - n(l.returnedQty), 0);
        const open = ["APPROVED", "PARTIALLY_RECEIVED"].includes(o.status);
        return {
          number: o.number, date: o.date, supplier: o.supplier.legalName, status: o.status, expectedDate: o.expectedDate,
          currency: o.currency, total: n(o.total), received: ordered ? Math.round((received / ordered) * 1000) / 10 : 0,
          daysLate: open && o.expectedDate && o.expectedDate.getTime() < now ? Math.floor((now - o.expectedDate.getTime()) / 86_400_000) : 0,
        };
      });
      return {
        columns: [{ key: "number", label: "PO" }, { key: "date", label: "Date", type: "date" }, { key: "supplier", label: "Supplier" }, { key: "status", label: "Status" }, { key: "expectedDate", label: "Expected", type: "date" }, { key: "currency", label: "Cur." }, { key: "total", label: "Total", type: "money" }, { key: "received", label: "Received %", type: "pct" }, { key: "daysLate", label: "Days late", type: "int" }],
        rows,
      };
    },
  },
  {
    key: "supplier-delivery-performance", title: "Supplier delivery performance", group: "Procurement", permission: "reports.view",
    description: "On-time receipt rate, average delay, rejection rate and open nonconformities per supplier.",
    filters: [{ kind: "dateRange" }],
    async run(p) {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT s.code, s."legalName" supplier, COUNT(g.id)::int receipts,
          COUNT(g.id) FILTER (WHERE po."expectedDate" IS NOT NULL AND g.date <= po."expectedDate" + interval '1 day')::int "onTime",
          COUNT(g.id) FILTER (WHERE po."expectedDate" IS NOT NULL)::int dated,
          COALESCE(AVG(GREATEST(0, EXTRACT(EPOCH FROM (g.date - po."expectedDate")) / 86400)) FILTER (WHERE po."expectedDate" IS NOT NULL), 0)::float "avgDelay",
          COALESCE((SELECT SUM(gl."rejectedQty") / NULLIF(SUM(gl."receivedQty"), 0) * 100 FROM "GoodsReceiptLine" gl JOIN "GoodsReceipt" g2 ON g2.id = gl."receiptId" WHERE g2."supplierId" = s.id AND g2.status = 'POSTED'), 0)::float "rejectionPct",
          (SELECT COUNT(*) FROM "SupplierIssue" si WHERE si."supplierId" = s.id AND si.status = 'OPEN')::int "openIssues"
        FROM "Supplier" s JOIN "GoodsReceipt" g ON g."supplierId" = s.id AND g.status = 'POSTED' ${range(p, "g.date")}
        JOIN "PurchaseOrder" po ON po.id = g."purchaseOrderId"
        GROUP BY s.id ORDER BY receipts DESC`;
      return {
        columns: [{ key: "code", label: "Code" }, { key: "supplier", label: "Supplier" }, { key: "receipts", label: "Receipts", type: "int" }, { key: "onTimePct", label: "On-time %", type: "pct" }, { key: "avgDelay", label: "Avg delay (days)", type: "qty" }, { key: "rejectionPct", label: "Rejected %", type: "pct" }, { key: "openIssues", label: "Open NCRs", type: "int" }],
        rows: rows.map((r) => ({ ...r, onTimePct: n(r.dated) ? Math.round((n(r.onTime) / n(r.dated)) * 1000) / 10 : null, avgDelay: Math.round(n(r.avgDelay) * 10) / 10, rejectionPct: Math.round(n(r.rejectionPct) * 10) / 10 })),
      };
    },
  },
  {
    key: "stock-on-hand", title: "Stock on hand", group: "Inventory", permission: "inventory.view",
    description: "On-hand, reserved and available quantity per item and warehouse.",
    filters: [{ kind: "warehouse" }, { kind: "category" }, { kind: "text" }],
    async run(p, ctx) {
      const data = await stockOnHandReport(ctx, p);
      const rows = data.map((r) => ({ code: r.item.code, name: r.item.name, category: r.item.category?.name ?? "", warehouse: r.warehouse.code, uom: r.item.uom.code, onHand: n(r.onHand), reserved: n(r.reserved), available: n(r.available) }));
      return { columns: [{ key: "code", label: "Item" }, { key: "name", label: "Description" }, { key: "category", label: "Category" }, { key: "warehouse", label: "Warehouse" }, { key: "uom", label: "UoM" }, { key: "onHand", label: "On hand", type: "qty" }, { key: "reserved", label: "Reserved", type: "qty" }, { key: "available", label: "Available", type: "qty" }], rows };
    },
  },
  {
    key: "stock-valuation", title: "Stock valuation", group: "Inventory", permission: "inventory.view",
    description: "On-hand quantity × weighted-average cost (QAR).",
    filters: [{ kind: "warehouse" }, { kind: "category" }],
    async run(p, ctx) {
      const data = await stockOnHandReport(ctx, p);
      const rows = data.map((r) => ({ code: r.item.code, name: r.item.name, category: r.item.category?.name ?? "", warehouse: r.warehouse.code, onHand: n(r.onHand), avgCost: n(r.avgCost), value: n(r.value) }));
      return { columns: [{ key: "code", label: "Item" }, { key: "name", label: "Description" }, { key: "category", label: "Category" }, { key: "warehouse", label: "Warehouse" }, { key: "onHand", label: "On hand", type: "qty" }, { key: "avgCost", label: "Avg cost", type: "money" }, { key: "value", label: "Value (QAR)", type: "money" }], rows, totals: sum(rows, "value") };
    },
  },
  {
    key: "low-stock", title: "Low-stock report", group: "Inventory", permission: "inventory.view",
    description: "Items at or below minimum level with suggested reorder quantities.",
    filters: [],
    async run() {
      const s = await lowStockSuggestions(prisma);
      const rows = s.map((x) => ({ code: x.item.code, name: x.item.name, min: n(x.item.minStockLevel), onHand: n(x.onHand), reserved: n(x.reserved), onOrder: n(x.onOrder), suggested: n(x.suggested), supplier: x.item.preferredSupplier?.legalName ?? "" }));
      return { columns: [{ key: "code", label: "Item" }, { key: "name", label: "Description" }, { key: "min", label: "Minimum", type: "qty" }, { key: "onHand", label: "On hand", type: "qty" }, { key: "reserved", label: "Reserved", type: "qty" }, { key: "onOrder", label: "On order", type: "qty" }, { key: "suggested", label: "Suggested order", type: "qty" }, { key: "supplier", label: "Preferred supplier" }], rows };
    },
  },
  {
    key: "slow-moving", title: "Slow & non-moving stock", group: "Inventory", permission: "inventory.view",
    description: "Items with stock but no issues/deliveries within the chosen number of days.",
    filters: [{ kind: "days" }],
    async run(p) {
      const s = await slowMovingItems(p.days ?? 90, 1000);
      const rows = s.map((x) => ({ code: x.code, name: x.name, qty: x.qty, value: x.value, lastOut: x.lastOut, status: x.nonMoving ? "Never issued" : "Slow moving" }));
      return { columns: [{ key: "code", label: "Item" }, { key: "name", label: "Description" }, { key: "qty", label: "On hand", type: "qty" }, { key: "value", label: "Value (QAR)", type: "money" }, { key: "lastOut", label: "Last issue", type: "date" }, { key: "status", label: "Status" }], rows, totals: sum(rows, "value") };
    },
  },
  {
    key: "stock-ledger", title: "Stock movement ledger", group: "Inventory", permission: "inventory.view",
    description: "Every posted stock movement with reference document and user.",
    filters: [{ kind: "dateRange" }, { kind: "warehouse" }, { kind: "text" }],
    async run(p) {
      const tx = await prisma.inventoryTransaction.findMany({
        where: {
          ...(p.warehouseId ? { warehouseId: p.warehouseId } : {}),
          ...(p.from || p.to ? { txnDate: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {}),
          ...(p.q ? { OR: [{ refDocNo: { contains: p.q, mode: "insensitive" } }, { item: { code: { contains: p.q, mode: "insensitive" } } }] } : {}),
        },
        include: { item: true }, orderBy: { seq: "desc" }, take: 10000,
      });
      const whs = new Map((await prisma.warehouse.findMany()).map((w) => [w.id, w.code]));
      const users = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      const batches = new Map((await prisma.batch.findMany({ where: { id: { in: tx.map((t) => t.batchId!).filter(Boolean) } } })).map((b) => [b.id, b.batchNo]));
      const rows = tx.map((t) => ({ date: t.txnDate, type: t.type, ref: t.refDocNo, item: t.item.code, warehouse: whs.get(t.warehouseId), batch: t.batchId ? batches.get(t.batchId) : "", qty: n(t.quantity), unitCost: n(t.unitCost), value: n(t.totalValue), balance: n(t.balanceAfter), user: users.get(t.userId) }));
      return { columns: [{ key: "date", label: "Date", type: "datetime" }, { key: "type", label: "Type" }, { key: "ref", label: "Reference" }, { key: "item", label: "Item" }, { key: "warehouse", label: "WH" }, { key: "batch", label: "Batch" }, { key: "qty", label: "Qty", type: "qty" }, { key: "unitCost", label: "Unit cost", type: "money" }, { key: "value", label: "Value", type: "money" }, { key: "balance", label: "Balance", type: "qty" }, { key: "user", label: "User" }], rows };
    },
  },
  {
    key: "stock-adjustments", title: "Stock adjustment report", group: "Inventory", permission: "inventory.view",
    description: "Adjustments and count variances with value impact.",
    filters: [{ kind: "dateRange" }, { kind: "warehouse" }],
    async run(p) {
      const tx = await prisma.inventoryTransaction.findMany({
        where: {
          type: { in: ["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "COUNT_GAIN", "COUNT_LOSS", "REVERSAL"] },
          ...(p.warehouseId ? { warehouseId: p.warehouseId } : {}),
          ...(p.from || p.to ? { txnDate: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {}),
        },
        include: { item: true }, orderBy: { seq: "desc" }, take: 10000,
      });
      const users = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      const rows = tx.map((t) => ({ date: t.txnDate, ref: t.refDocNo, type: t.type, item: t.item.code, name: t.item.name, qty: n(t.quantity), value: n(t.totalValue), reason: t.notes ?? "", user: users.get(t.userId) }));
      return { columns: [{ key: "date", label: "Date", type: "datetime" }, { key: "ref", label: "Reference" }, { key: "type", label: "Type" }, { key: "item", label: "Item" }, { key: "name", label: "Description" }, { key: "qty", label: "Qty", type: "qty" }, { key: "value", label: "Value (QAR)", type: "money" }, { key: "reason", label: "Reason" }, { key: "user", label: "Posted by" }], rows, totals: sum(rows, "value") };
    },
  },
  {
    key: "expiring", title: "Expiring batches & certificates", group: "Inventory", permission: "inventory.view",
    description: "Batches in stock and supplier certificates expiring within N days (or already expired).",
    filters: [{ kind: "days" }],
    async run(p) {
      const until = new Date(Date.now() + (p.days ?? 90) * 86_400_000);
      const batches = await prisma.batch.findMany({ where: { expiryDate: { lte: until } }, include: { item: true, balances: true } });
      const docs = await prisma.supplierDocument.findMany({ where: { expiryDate: { lte: until } }, include: { supplier: true } });
      const now = Date.now();
      const rows = [
        ...batches.map((b) => ({ kind: "Batch", reference: `${b.item.code} / ${b.batchNo}`, owner: b.item.name, qty: n(b.balances.reduce((s, x) => s + n(x.quantity), 0)), expiry: b.expiryDate })).filter((r) => r.qty > 0),
        ...docs.map((d) => ({ kind: "Supplier certificate", reference: `${d.docType}${d.docNumber ? ` ${d.docNumber}` : ""}`, owner: d.supplier.legalName, qty: null, expiry: d.expiryDate })),
      ].map((r) => ({ ...r, days: Math.floor((r.expiry!.getTime() - now) / 86_400_000) })).sort((a, b) => a.days - b.days);
      return { columns: [{ key: "kind", label: "Type" }, { key: "reference", label: "Reference" }, { key: "owner", label: "Item / supplier" }, { key: "qty", label: "Qty in stock", type: "qty" }, { key: "expiry", label: "Expiry", type: "date" }, { key: "days", label: "Days left", type: "int" }], rows };
    },
  },
  {
    key: "pending-approvals", title: "Pending approvals", group: "Control", permission: "reports.view",
    description: "Documents awaiting approval with age and value.",
    filters: [],
    async run() {
      const [q, so, pr, po, sd] = await Promise.all([
        prisma.salesQuotation.findMany({ where: { status: "SUBMITTED" }, include: { customer: true } }),
        prisma.salesOrder.findMany({ where: { status: "SUBMITTED" }, include: { customer: true } }),
        prisma.purchaseRequest.findMany({ where: { status: "SUBMITTED" } }),
        prisma.purchaseOrder.findMany({ where: { status: "SUBMITTED" }, include: { supplier: true } }),
        prisma.stockDocument.findMany({ where: { status: { in: ["DRAFT", "SUBMITTED"] }, type: { in: ["ADJUSTMENT", "OPENING"] } } }),
      ]);
      const users = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      const age = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);
      const rows = [
        ...q.map((x) => ({ type: "Sales quotation", number: x.number, party: x.customer.legalName, value: round2(D(x.total).mul(D(x.exchangeRate))).toNumber(), preparedBy: users.get(x.createdById), date: x.updatedAt, age: age(x.updatedAt) })),
        ...so.map((x) => ({ type: "Sales order", number: x.number, party: x.customer.legalName, value: round2(D(x.total).mul(D(x.exchangeRate))).toNumber(), preparedBy: users.get(x.createdById), date: x.updatedAt, age: age(x.updatedAt) })),
        ...pr.map((x) => ({ type: "Purchase request", number: x.number, party: x.department ?? "", value: n(x.estimatedTotal), preparedBy: users.get(x.requestedById), date: x.updatedAt, age: age(x.updatedAt) })),
        ...po.map((x) => ({ type: "Purchase order", number: x.number, party: x.supplier.legalName, value: round2(D(x.total).mul(D(x.exchangeRate))).toNumber(), preparedBy: users.get(x.createdById), date: x.updatedAt, age: age(x.updatedAt) })),
        ...sd.map((x) => ({ type: `Stock ${x.type.toLowerCase()}`, number: x.number, party: x.reason ?? "", value: null, preparedBy: users.get(x.createdById), date: x.updatedAt, age: age(x.updatedAt) })),
      ].sort((a, b) => b.age - a.age);
      return { columns: [{ key: "type", label: "Document" }, { key: "number", label: "Number" }, { key: "party", label: "Party / reason" }, { key: "value", label: "Value (QAR)", type: "money" }, { key: "preparedBy", label: "Prepared by" }, { key: "date", label: "Since", type: "date" }, { key: "age", label: "Age (days)", type: "int" }], rows };
    },
  },
  {
    key: "audit-trail", title: "Audit trail", group: "Control", permission: "audit.view",
    description: "Who did what and when, for all important operations.",
    filters: [{ kind: "dateRange" }, { kind: "text" }],
    async run(p) {
      const logs = await prisma.auditLog.findMany({
        where: {
          ...(p.from || p.to ? { createdAt: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {}),
          ...(p.q ? { OR: [{ summary: { contains: p.q, mode: "insensitive" } }, { entity: { contains: p.q, mode: "insensitive" } }, { userName: { contains: p.q, mode: "insensitive" } }] } : {}),
        },
        orderBy: { createdAt: "desc" }, take: 10000,
      });
      const rows = logs.map((l) => ({ time: l.createdAt, user: l.userName ?? "system", action: l.action, entity: l.entity, summary: l.summary ?? "", ip: l.ip ?? "" }));
      return { columns: [{ key: "time", label: "Time", type: "datetime" }, { key: "user", label: "User" }, { key: "action", label: "Action" }, { key: "entity", label: "Entity" }, { key: "summary", label: "Summary" }, { key: "ip", label: "IP" }], rows };
    },
  },
];

export function getReport(key: string) {
  return REPORTS.find((r) => r.key === key);
}

export async function runReport(ctx: Ctx, key: string, params: ReportParams) {
  const def = getReport(key);
  if (!def) return null;
  requirePerm(ctx, def.permission);
  return { def, result: await def.run(params, ctx) };
}
