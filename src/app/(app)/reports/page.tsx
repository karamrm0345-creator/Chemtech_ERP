import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { REPORTS } from "@/server/services/reports";
import { PageHeader, Card } from "@/components/ui/primitives";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const user = await requireUser("reports.view", "inventory.view", "audit.view");
  const visible = REPORTS.filter((r) => user.permissions.has(r.permission));
  const groups = [...new Set(visible.map((r) => r.group))];
  return (
    <>
      <PageHeader title="Reports" subtitle="Calculated live from database records. Export to Excel/CSV or print to PDF from each report." crumbs={[{ label: "Insight" }, { label: "Reports" }]} />
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Card key={g} title={g} bodyClass="p-0">
            <ul className="divide-y divide-line">
              {visible.filter((r) => r.group === g).map((r) => (
                <li key={r.key}><Link href={`/reports/${r.key}`} className="flex items-start gap-3 px-4 py-3 hover:bg-panel/60">
                  <FileBarChart className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
                  <span><span className="block font-semibold">{r.title}</span><span className="text-sm text-ink-soft">{r.description}</span></span>
                </Link></li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
