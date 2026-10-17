import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { humanize } from "@/lib/format";

type BtnVariant = "primary" | "action" | "outline" | "ghost" | "danger";
const btnBase = "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap";
export const btnStyles: Record<BtnVariant, string> = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 shadow-sm",
  action: "bg-action-500 text-white hover:bg-action-600 shadow-sm",
  outline: "border border-line bg-white text-ink hover:bg-panel",
  ghost: "text-ink-soft hover:bg-panel hover:text-ink",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
};
export function btn(variant: BtnVariant = "primary", className?: string) {
  return cn(btnBase, btnStyles[variant], className);
}

export function LinkButton({ href, variant = "primary", className, children }: { href: string; variant?: BtnVariant; className?: string; children: React.ReactNode }) {
  return <Link href={href} className={btn(variant, className)}>{children}</Link>;
}

export interface Crumb { label: string; href?: string }

export function PageHeader({ title, subtitle, crumbs = [], actions }: { title: React.ReactNode; subtitle?: React.ReactNode; crumbs?: Crumb[]; actions?: React.ReactNode }) {
  return (
    <div className="mb-5">
      {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-ink-muted no-print">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              {c.href ? <Link href={c.href} className="hover:text-brand-600">{c.label}</Link> : <span className="text-ink-soft">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-ink-soft">{subtitle}</div>}
        </div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClass }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn("card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">{title}</h2>}
          {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-200",
  SUBMITTED: "bg-amber-50 text-amber-800 ring-amber-200",
  PENDING: "bg-amber-50 text-amber-800 ring-amber-200",
  APPROVED: "bg-brand-50 text-brand-700 ring-brand-200",
  SENT: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  ACCEPTED: "bg-green-50 text-green-700 ring-green-200",
  CONVERTED: "bg-green-50 text-green-700 ring-green-200",
  SELECTED: "bg-green-50 text-green-700 ring-green-200",
  AWARDED: "bg-green-50 text-green-700 ring-green-200",
  POSTED: "bg-green-50 text-green-700 ring-green-200",
  DELIVERED: "bg-green-50 text-green-700 ring-green-200",
  RECEIVED: "bg-green-50 text-green-700 ring-green-200",
  ORDERED: "bg-green-50 text-green-700 ring-green-200",
  PAID: "bg-green-50 text-green-700 ring-green-200",
  MATCHED: "bg-green-50 text-green-700 ring-green-200",
  COMPLIANT: "bg-green-50 text-green-700 ring-green-200",
  IN_STOCK: "bg-green-50 text-green-700 ring-green-200",
  OK: "bg-green-50 text-green-700 ring-green-200",
  ACTIVE: "bg-green-50 text-green-700 ring-green-200",
  PARTIALLY_DELIVERED: "bg-sky-50 text-sky-700 ring-sky-200",
  PARTIALLY_RECEIVED: "bg-sky-50 text-sky-700 ring-sky-200",
  PARTIALLY_ORDERED: "bg-sky-50 text-sky-700 ring-sky-200",
  PARTIALLY_PAID: "bg-sky-50 text-sky-700 ring-sky-200",
  PARTIAL: "bg-amber-50 text-amber-800 ring-amber-200",
  CONDITIONAL: "bg-amber-50 text-amber-800 ring-amber-200",
  LOW: "bg-amber-50 text-amber-800 ring-amber-200",
  VARIANCE: "bg-amber-50 text-amber-800 ring-amber-200",
  OPEN: "bg-amber-50 text-amber-800 ring-amber-200",
  RENTED_OUT: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  CLOSED: "bg-slate-100 text-slate-600 ring-slate-200",
  REVISED: "bg-slate-100 text-slate-600 ring-slate-200",
  RELEASED: "bg-slate-100 text-slate-600 ring-slate-200",
  CONSUMED: "bg-slate-100 text-slate-600 ring-slate-200",
  NOT_STARTED: "bg-slate-100 text-slate-600 ring-slate-200",
  NOT_EVALUATED: "bg-slate-100 text-slate-600 ring-slate-200",
  NON_STOCK: "bg-slate-100 text-slate-600 ring-slate-200",
  NONE: "bg-slate-100 text-slate-600 ring-slate-200",
  INACTIVE: "bg-slate-100 text-slate-600 ring-slate-200",
  REJECTED: "bg-red-50 text-red-700 ring-red-200",
  CANCELLED: "bg-red-50 text-red-700 ring-red-200",
  REVERSED: "bg-red-50 text-red-700 ring-red-200",
  NON_COMPLIANT: "bg-red-50 text-red-700 ring-red-200",
  EXPIRED: "bg-red-50 text-red-700 ring-red-200",
  OUT: "bg-red-50 text-red-700 ring-red-200",
  OVERDUE: "bg-red-50 text-red-700 ring-red-200",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", STATUS_TONE[status] ?? "bg-slate-100 text-slate-700 ring-slate-200")}>
      {label ?? humanize(status)}
    </span>
  );
}

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "blue" | "green" | "amber" | "red" }) {
  const t = { slate: "bg-slate-100 text-slate-700", blue: "bg-brand-50 text-brand-700", green: "bg-green-50 text-green-700", amber: "bg-amber-50 text-amber-800", red: "bg-red-50 text-red-700" }[tone];
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold", t)}>{children}</span>;
}

export function KeyValues({ items, cols = 3 }: { items: [string, React.ReactNode][]; cols?: 2 | 3 | 4 }) {
  const c = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", c)}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-md text-sm text-ink-soft">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "danger" | "success"; children: React.ReactNode }) {
  const t = { info: "border-brand-200 bg-brand-50 text-brand-800", warning: "border-amber-200 bg-amber-50 text-amber-900", danger: "border-red-200 bg-red-50 text-red-800", success: "border-green-200 bg-green-50 text-green-800" }[tone];
  return <div className={cn("rounded-md border px-3 py-2 text-sm", t)}>{children}</div>;
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="no-print mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} scroll={false}
          className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", t.key === active ? "border-brand-500 text-brand-600" : "border-transparent text-ink-soft hover:text-ink")}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-panel px-1.5 text-xs text-ink-soft">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}
