import { Logo } from "@/components/layout/shell";

const FEATURES = [
  "Sales & quotations", "Procurement", "Store & inventory", "Customer management",
  "Supplier management", "Executive dashboard", "Approvals & audit trail", "Reports & exports",
];

/** Split layout modelled on the reference screenshot: form card + brand panel. */
export function AuthLayout({ company, title, children }: { company: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white lg:flex-row">
      <div className="flex w-full items-center justify-center px-5 py-10 lg:w-[480px] lg:shrink-0 lg:border-r lg:border-line lg:shadow-[4px_0_20px_rgba(16,33,58,0.06)]">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo name={company} /></div>
          <h1 className="mb-6 text-3xl font-extrabold tracking-tight">{title}</h1>
          {children}
        </div>
      </div>
      <div className="relative hidden flex-1 overflow-hidden bg-panel lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div aria-hidden className="absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full border-[90px] border-white/60" />
        <div className="relative max-w-xl">
          <div className="mb-10 scale-125 origin-left"><Logo name={company} /></div>
          <p className="text-2xl font-extrabold leading-snug text-ink">Everything you need to run your operations in one integrated system.</p>
          <p className="mt-3 text-base text-ink-soft">Sales, procurement, store and inventory, customers and suppliers on one shared database, with live management dashboards.</p>
          <ul className="mt-12 grid grid-cols-2 gap-x-8 gap-y-4">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm font-bold text-ink">
                <span className="text-brand-500" aria-hidden>❯</span>{f}
              </li>
            ))}
          </ul>
          <p className="mt-14 text-xs text-ink-muted">Oil & gas services and supply · Doha, Qatar</p>
        </div>
      </div>
    </div>
  );
}
