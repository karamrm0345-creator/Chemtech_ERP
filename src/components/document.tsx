import { Fragment } from "react";
import { prisma } from "@/server/db";
import { fmtAmount, fmtDate, fmtQty } from "@/lib/format";

export interface DocLine { no: number; code?: string | null; description: string; qty: unknown; uom?: string | null; unitPrice?: unknown; discountPct?: unknown; taxRate?: unknown; total?: unknown; extra?: React.ReactNode }

/**
 * Printable commercial document (quotation, order, PO, delivery note, invoice, GRN).
 * Uses company settings for the letterhead; prints cleanly via the browser.
 */
export async function CommercialDocument({
  title, number, meta, partyLabel, party, lines, currency, totals, notes, showPrices = true, signatures = ["Prepared by", "Approved by"],
}: {
  title: string; number: string; meta: [string, React.ReactNode][]; partyLabel: string;
  party: { name: string; lines: (string | null | undefined)[] }; lines: DocLine[]; currency?: string;
  totals?: [string, unknown][]; notes?: string | null; showPrices?: boolean; signatures?: string[];
}) {
  const s = await prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } });
  const anyDiscount = lines.some((l) => Number(l.discountPct ?? 0) > 0);
  return (
    <article className="card p-5 sm:p-8 print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-brand-500 pb-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand-500 text-2xl font-black text-white">{s.companyName.charAt(0)}</span>
          <div>
            <p className="text-lg font-extrabold">{s.legalName || s.companyName}</p>
            <p className="text-xs text-ink-soft">{[s.address, s.phone, s.email].filter(Boolean).join(" · ")}</p>
            <p className="text-xs text-ink-soft">{[s.crNumber && `CR ${s.crNumber}`, s.taxNumber && `Tax ${s.taxNumber}`].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-extrabold uppercase tracking-wide text-brand-600">{title}</p>
          <p className="font-mono text-sm">{number}</p>
        </div>
      </header>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase text-ink-muted">{partyLabel}</p>
          <p className="font-semibold">{party.name}</p>
          {party.lines.filter(Boolean).map((l, i) => <p key={i} className="text-sm text-ink-soft">{l}</p>)}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:justify-self-end">
          {meta.map(([k, v]) => (<Fragment key={k}><dt className="text-ink-muted">{k}</dt><dd className="font-medium">{v || "—"}</dd></Fragment>))}
        </dl>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-8">#</th><th>Description</th><th className="text-right">Qty</th><th>UoM</th>
              {showPrices && <><th className="text-right">Unit price</th>{anyDiscount && <th className="text-right">Disc %</th>}<th className="text-right">Tax %</th><th className="text-right">Amount</th></>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.no}>
                <td>{l.no}</td>
                <td>{l.code && <span className="mr-1 font-mono text-xs text-ink-muted">{l.code}</span>}{l.description}{l.extra && <div className="text-xs text-ink-soft">{l.extra}</div>}</td>
                <td className="num">{fmtQty(l.qty as never)}</td><td>{l.uom}</td>
                {showPrices && <><td className="num">{fmtAmount(l.unitPrice as never)}</td>{anyDiscount && <td className="num">{fmtQty(l.discountPct as never)}</td>}<td className="num">{fmtQty(l.taxRate as never)}</td><td className="num font-medium">{fmtAmount(l.total as never)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showPrices && totals && (
        <dl className="ml-auto mt-3 w-full max-w-xs space-y-1 text-sm">
          {totals.map(([k, v], i) => (
            <div key={k} className={`flex justify-between ${i === totals.length - 1 ? "border-t border-line pt-1 text-base font-bold" : ""}`}>
              <dt className={i === totals.length - 1 ? "" : "text-ink-soft"}>{k}</dt><dd className="tabular-nums">{i === totals.length - 1 && currency ? `${currency} ` : ""}{fmtAmount(v as never)}</dd>
            </div>
          ))}
        </dl>
      )}
      {notes && <div className="mt-5 whitespace-pre-wrap rounded-md bg-panel p-3 text-sm print:bg-transparent print:p-0"><p className="mb-1 text-xs font-bold uppercase text-ink-muted">Notes & terms</p>{notes}</div>}
      <footer className="mt-10 hidden grid-cols-3 gap-8 text-xs text-ink-soft print:grid">
        {signatures.map((sig) => <div key={sig} className="border-t border-ink/40 pt-1">{sig}</div>)}
      </footer>
      <p className="mt-6 hidden text-[10px] text-ink-muted print:block">Printed {fmtDate(new Date())} · {s.companyName} ERP</p>
    </article>
  );
}
