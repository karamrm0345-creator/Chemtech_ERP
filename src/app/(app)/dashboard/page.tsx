import Link from "next/link";
import { AlertTriangle, AlertOctagon, Info, ArrowUpRight } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { getKpis, getCharts, getAlerts, slowMovingItems, type DashboardFilter } from "@/server/services/dashboard";
import { PageHeader, Card, Notice } from "@/components/ui/primitives";
import { TrendChart, GroupedBars, RankBars } from "@/components/charts/charts";
import { parseBusinessDate, fmtMoney, fmtCompact, fmtDate, toDateInput, fmtQty } from "@/lib/format";
import { str, type SP } from "@/lib/params";
import { cn } from "@/lib/cn";
import { DashboardFilters } from "./filters";

export const metadata = { title: "Executive dashboard" };

function resolveRange(sp: SP): { from: Date; to: Date; label: string } {
  const now = new Date();
  const today = parseBusinessDate(toDateInput(now))!;
  const end = new Date(today.getTime() + 86_399_999);
  const [y, m] = toDateInput(now).split("-").map(Number);
  switch (str(sp, "range") ?? "12m") {
    case "mtd": return { from: parseBusinessDate(`${y}-${String(m).padStart(2, "0")}-01`)!, to: end, label: "This month" };
    case "30d": return { from: new Date(today.getTime() - 29 * 86_400_000), to: end, label: "Last 30 days" };
    case "90d": return { from: new Date(today.getTime() - 89 * 86_400_000), to: end, label: "Last 90 days" };
    case "ytd": return { from: parseBusinessDate(`${y}-01-01`)!, to: end, label: "Year to date" };
    case "custom": {
      const f = parseBusinessDate(str(sp, "from")) ?? parseBusinessDate(`${y}-01-01`)!;
      const t = parseBusinessDate(str(sp, "to"));
      return { from: f, to: t ? new Date(t.getTime() + 86_399_999) : end, label: `${fmtDate(f)} – ${fmtDate(t ?? end)}` };
    }
    default: {
      const start = new Date(Date.UTC(y, m - 12, 1));
      return { from: parseBusinessDate(start.toISOString().slice(0, 10))!, to: end, label: "Last 12 months" };
    }
  }
}

function Kpi({ label, value, sub, href, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: "red" | "amber" | "green" }) {
  const body = (
    <div className={cn("card group h-full p-4 transition", href && "hover:border-brand-300 hover:shadow-md")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
        {href && <ArrowUpRight className="h-4 w-4 text-ink-muted opacity-0 transition group-hover:opacity-100" />}
      </div>
      <p className={cn("mt-1.5 text-2xl font-extrabold tabular-nums", tone === "red" && "text-red-600", tone === "amber" && "text-amber-600", tone === "green" && "text-green-700")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

const SEV = {
  critical: { icon: AlertOctagon, cls: "text-red-600", label: "Critical" },
  warning: { icon: AlertTriangle, cls: "text-amber-600", label: "Warning" },
  info: { icon: Info, cls: "text-brand-600", label: "Info" },
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("dashboard.executive");
  const sp = await searchParams;
  const r = resolveRange(sp);
  const f: DashboardFilter = { from: r.from, to: r.to, customerId: str(sp, "customerId"), supplierId: str(sp, "supplierId"), categoryId: str(sp, "categoryId") };
  const settings = await prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } });
  const [k, c, alerts, slow, cats, cust, sup] = await Promise.all([
    getKpis(user, f), getCharts(user, f), getAlerts(user), slowMovingItems(settings.slowMovingDays, 8),
    prisma.itemCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    f.customerId ? prisma.customer.findUnique({ where: { id: f.customerId }, select: { legalName: true } }) : null,
    f.supplierId ? prisma.supplier.findUnique({ where: { id: f.supplierId }, select: { legalName: true } }) : null,
  ]);
  const qs = (extra: string) => extra;
  return (
    <>
      <PageHeader title="Executive dashboard" subtitle={<>{r.label} · live figures in QAR (base currency) · {fmtDate(new Date())}</>} crumbs={[{ label: "Overview" }, { label: "Dashboard" }]} />
      <DashboardFilters categories={cats.map((x) => ({ value: x.id, label: x.name }))} customerLabel={cust?.legalName} supplierLabel={sup?.legalName} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Confirmed revenue" value={fmtCompact(k.confirmedRevenue.value)} sub={k.financeEnabled ? `${k.confirmedRevenue.count} posted invoice(s), net of tax` : "Finance disabled: no invoices"} href={qs("/finance/sales-invoices")} />
        <Kpi label="Order intake" value={fmtCompact(k.orderIntake.value)} sub={`${k.orderIntake.count} approved order(s), not revenue`} href="/reports/sales-by-period" />
        <Kpi label="Delivered value" value={fmtCompact(k.deliveredValue)} sub="Posted deliveries at order price" href="/sales/deliveries?status=POSTED" />
        <Kpi label="Quotation pipeline" value={fmtCompact(k.quotationPipeline.value)} sub={`${k.quotationPipeline.count} open quotation(s)`} href="/sales/quotations" />
        <Kpi label="Purchases" value={fmtCompact(k.purchases.value)} sub={`${k.purchases.count} approved PO(s)`} href="/reports/purchases-by-supplier" />
        <Kpi label="Inventory value" value={fmtCompact(k.inventoryValue)} sub={`${k.stockedItems} stocked items, weighted avg cost`} href="/inventory/stock" />
        <Kpi label="Sales orders open" value={k.soAwaiting} sub="Submitted, approved, part-delivered" href="/sales/orders?status=OPEN" />
        <Kpi label="POs awaiting approval" value={k.poAwaitingApproval} href="/purchasing/orders?status=SUBMITTED" tone={k.poAwaitingApproval ? "amber" : undefined} />
        <Kpi label="POs awaiting delivery" value={k.poAwaitingDelivery} sub={k.poOverdue ? `${k.poOverdue} overdue` : "none overdue"} href={k.poOverdue ? "/purchasing/orders?status=OVERDUE" : "/purchasing/orders?status=OPEN"} tone={k.poOverdue ? "red" : undefined} />
        <Kpi label="Low stock" value={k.lowStock} href="/inventory/low-stock" tone={k.lowStock ? "amber" : "green"} />
        <Kpi label="Out of stock" value={k.outOfStock} sub="Items with a minimum level" href="/inventory/items?stock=out" tone={k.outOfStock ? "red" : "green"} />
        <Kpi label="Pending approvals" value={k.pendingApprovals} sub={`${k.approvals.salesOrders} SO · ${k.approvals.purchaseOrders} PO · ${k.approvals.purchaseRequests} PR · ${k.approvals.quotations} quotes · ${k.approvals.stockAdjustments} stock`} href="/approvals" tone={k.pendingApprovals ? "amber" : undefined} />
      </div>
      {k.finance ? (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Customer receivables" value={fmtMoney(k.finance.receivables)} href="/finance/sales-invoices?status=OPEN" />
          <Kpi label="Overdue invoices" value={k.finance.overdueCount} sub={fmtMoney(k.finance.overdueAmount)} href="/finance/sales-invoices?status=OVERDUE" tone={k.finance.overdueCount ? "red" : "green"} />
          <Kpi label="Supplier payables" value={fmtMoney(k.finance.payables)} href="/finance/purchase-invoices?status=OPEN" />
          <Kpi label="Profit" value={<span className="text-base font-semibold text-ink-muted">Not reported</span>} sub="Requires a general ledger and full cost accounting" />
        </div>
      ) : (
        k.financeEnabled && <p className="mt-3 text-xs text-ink-muted">Receivables and payables are hidden for your role.</p>
      )}

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <Card title="Sales vs purchases by month" className="xl:col-span-2">
          <TrendChart data={c.monthly} series={[{ key: "invoiced", label: "Invoiced revenue" }, { key: "orders", label: "Order intake" }, { key: "purchases", label: "Purchases (approved POs)" }]} />
        </Card>
        <Card title={`Management alerts (${alerts.length})`} bodyClass="p-0">
          {alerts.length === 0 ? <p className="p-4 text-sm text-ink-muted">No alerts. All monitored conditions are within limits.</p> : (
            <ul className="max-h-[330px] divide-y divide-line overflow-y-auto">
              {alerts.slice(0, 40).map((a, i) => {
                const S = SEV[a.severity];
                return (
                  <li key={i}>
                    <Link href={a.href} className="flex gap-2.5 px-4 py-2.5 text-sm hover:bg-panel/60">
                      <S.icon className={cn("mt-0.5 h-4 w-4 shrink-0", S.cls)} aria-label={S.label} />
                      <span><span className="block text-[11px] font-bold uppercase tracking-wide text-ink-muted">{a.category}</span>{a.message}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Sales by customer (order intake)"><RankBars data={c.salesByCustomer} hrefBase="/customers" /></Card>
        <Card title="Purchases by supplier"><RankBars data={c.purchasesBySupplier} hrefBase="/suppliers" /></Card>
        <Card title="Inventory value by category"><RankBars data={c.inventoryByCategory} emptyHint="Post opening balances or goods receipts" /></Card>
        <Card title="Stock movement value (excl. opening balances & transfers)" className="lg:col-span-2"><GroupedBars data={c.stockMovement} series={[{ key: "inbound", label: "Inbound" }, { key: "outbound", label: "Outbound" }]} /></Card>
        <Card title="Top-selling products (delivered)"><RankBars data={c.topProducts.map((p) => ({ id: p.id, name: `${p.code} ${p.name}`, value: p.value }))} hrefBase="/inventory/items" /></Card>
      </div>

      <div className="mt-4">
        <Card title={`Slow & non-moving stock (no issues in ${settings.slowMovingDays} days)`} actions={<Link className="link text-xs" href={`/reports/slow-moving?days=${settings.slowMovingDays}`}>Full report</Link>} bodyClass="p-0">
          {slow.length === 0 ? <p className="p-4 text-sm text-ink-muted">No slow-moving stock.</p> : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Item</th><th>Description</th><th className="text-right">On hand</th><th className="text-right">Value (QAR)</th><th>Last issue</th></tr></thead>
                <tbody>{slow.map((s) => <tr key={s.id}><td><Link className="link whitespace-nowrap font-mono text-xs" href={`/inventory/items/${s.id}`}>{s.code}</Link></td><td>{s.name}</td><td className="num">{fmtQty(s.qty)}</td><td className="num">{fmtMoney(s.value, "")}</td><td>{s.lastOut ? fmtDate(s.lastOut) : <span className="text-xs text-ink-muted">never issued</span>}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {!k.financeEnabled && <div className="mt-4"><Notice>Finance is disabled, so confirmed revenue, receivables and payables are unavailable. Order intake and delivered value are shown instead and are clearly not revenue.</Notice></div>}
    </>
  );
}
