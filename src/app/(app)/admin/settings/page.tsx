import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { PageHeader, Card } from "@/components/ui/primitives";
import { AttachmentsPanel } from "@/components/panels";
import { SettingsForm, SequenceRow, CurrencyEditor, CriteriaEditor } from "./forms";

export const metadata = { title: "Company settings" };

export default async function SettingsPage() {
  const user = await requireUser("admin.settings");
  const [s, seqs, currencies, criteria] = await Promise.all([
    prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.documentSequence.findMany({ where: { NOT: { docType: { contains: ":" } } }, orderBy: { docType: "asc" } }),
    prisma.currency.findMany({ orderBy: { code: "asc" } }),
    prisma.evaluationCriterion.findMany({ orderBy: { sort: "asc" } }),
  ]);
  const counters = await prisma.documentSequence.findMany({ where: { docType: { contains: ":" } } });
  return (
    <>
      <PageHeader title="Company settings" subtitle="Company profile, business rules, document numbering, currencies and supplier evaluation criteria." crumbs={[{ label: "Administration" }, { label: "Settings" }]} />
      <div className="space-y-4">
        <SettingsForm initial={{ ...s, defaultTaxRate: s.defaultTaxRate.toString(), grnTolerancePct: s.grnTolerancePct.toString(), adjustmentAlertQty: s.adjustmentAlertQty.toString() }} currencies={currencies.map((c) => c.code)} />
        <AttachmentsPanel user={user} docType="COMPANY" docId="1" title="Company logo & documents" />
        <Card title="Document numbering" bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Document</th><th>Prefix</th><th>Padding</th><th>Yearly reset</th><th>Next number (current period)</th><th /></tr></thead>
              <tbody>
                {seqs.map((q) => {
                  const cur = counters.filter((c) => c.docType.startsWith(q.docType + ":")).sort((a, b) => b.docType.localeCompare(a.docType))[0];
                  return <SequenceRow key={q.docType} docType={q.docType} prefix={q.prefix} padding={q.padding} includeYear={q.includeYear} next={cur?.nextNumber ?? 1} />;
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <CurrencyEditor base={s.baseCurrency} currencies={currencies.map((c) => ({ code: c.code, name: c.name, rateToBase: c.rateToBase.toString(), active: c.active }))} />
          <CriteriaEditor criteria={criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight.toString(), active: c.active, sort: c.sort }))} />
        </div>
      </div>
    </>
  );
}
