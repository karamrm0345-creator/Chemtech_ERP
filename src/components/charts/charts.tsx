"use client";
/**
 * Dashboard charts. Palette = validated reference categorical slots 1–3
 * (blue, orange, aqua; light mode). Single-series charts use slot 1 only.
 * Thin marks, 4px rounded data ends, recessive solid grid, crosshair tooltips
 * on lines, per-bar tooltips, legend for ≥2 series, and a table view.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell, LabelList,
} from "recharts";
import { fmtAmount, fmtCompact } from "@/lib/format";

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a"];
const GRID = "#e6e9ee";
const AXIS = { fontSize: 11, fill: "#52514e" };

const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
};

type TipProps = { active?: boolean; label?: string; payload?: { name: string; value: number; color: string; dataKey: string }[] };
function LineTip({ active, label, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-ink-soft">{label ? monthLabel(label) : ""}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3" style={{ background: p.color }} />
          <b className="tabular-nums text-ink">QAR {fmtAmount(p.value)}</b><span className="text-ink-soft">{p.name}</span>
        </p>
      ))}
    </div>
  );
}

export function Legend({ items, kind = "line" }: { items: { label: string; color: string }[]; kind?: "line" | "rect" }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-ink-soft">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={kind === "line" ? "inline-block h-0.5 w-4" : "inline-block h-2.5 w-2.5 rounded-sm"} style={{ background: i.color }} />{i.label}
        </span>
      ))}
    </div>
  );
}

function TableToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return <button type="button" onClick={onToggle} className="text-xs font-semibold text-brand-600 hover:underline">{open ? "Show chart" : "View as table"}</button>;
}

export interface SeriesDef { key: string; label: string }

/** Multi-series monthly line chart (same unit, one axis). */
export function TrendChart({ data, series, height = 260 }: { data: Record<string, number | string>[]; series: SeriesDef[]; height?: number }) {
  const [table, setTable] = useState(false);
  const empty = data.every((d) => series.every((s) => !Number(d[s.key])));
  const last = data.length - 1;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Legend items={series.map((s, i) => ({ label: s.label, color: SERIES[i] }))} />
        <TableToggle open={table} onToggle={() => setTable(!table)} />
      </div>
      {empty ? <EmptyChart height={height} /> : table ? (
        <div className="max-h-[300px] overflow-auto">
          <table className="table-base text-xs">
            <thead><tr><th>Month</th>{series.map((s) => <th key={s.key} className="text-right">{s.label}</th>)}</tr></thead>
            <tbody>{data.map((d) => <tr key={String(d.month)}><td>{monthLabel(String(d.month))}</td>{series.map((s) => <td key={s.key} className="num">{fmtAmount(Number(d[s.key]))}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 10, right: 56, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} minTickGap={16} />
            <YAxis tickFormatter={(v) => fmtCompact(v)} tick={AXIS} axisLine={false} tickLine={false} width={48} />
            <Tooltip content={<LineTip />} cursor={{ stroke: "#9aa5b4", strokeWidth: 1 }} />
            {series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES[i]} strokeWidth={2} dot={false}
                activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false}>
                <LabelList dataKey={s.key} content={(p) => {
                  const { x, y, index, value } = p as { x: number; y: number; index: number; value: number };
                  if (index !== last || !value) return null;
                  return <text x={x + 6} y={y} dy={4} fontSize={10} fill="#52514e">{fmtCompact(value)}</text>;
                }} />
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Grouped bars for two related series (e.g. stock in vs out). */
export function GroupedBars({ data, series, height = 240 }: { data: Record<string, number | string>[]; series: SeriesDef[]; height?: number }) {
  const [table, setTable] = useState(false);
  const empty = data.every((d) => series.every((s) => !Number(d[s.key])));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2"><Legend kind="rect" items={series.map((s, i) => ({ label: s.label, color: SERIES[i] }))} /><TableToggle open={table} onToggle={() => setTable(!table)} /></div>
      {empty ? <EmptyChart height={height} /> : table ? (
        <table className="table-base text-xs"><thead><tr><th>Month</th>{series.map((s) => <th key={s.key} className="text-right">{s.label}</th>)}</tr></thead>
          <tbody>{data.map((d) => <tr key={String(d.month)}><td>{monthLabel(String(d.month))}</td>{series.map((s) => <td key={s.key} className="num">{fmtAmount(Number(d[s.key]))}</td>)}</tr>)}</tbody></table>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} minTickGap={12} />
            <YAxis tickFormatter={(v) => fmtCompact(v)} tick={AXIS} axisLine={false} tickLine={false} width={48} />
            <Tooltip content={<LineTip />} cursor={{ fill: "rgba(31,111,229,0.06)" }} />
            {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Horizontal ranked bars, single series (slot 1). Each bar links to its record. */
export function RankBars({ data, hrefBase, valueLabel = "QAR", emptyHint }: { data: { id: string | null; name: string; value: number }[]; hrefBase?: string; valueLabel?: string; emptyHint?: string }) {
  const router = useRouter();
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <EmptyChart height={160} hint={emptyHint} />;
  const height = Math.max(120, data.length * 34 + 10);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }} barCategoryGap={8}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={150} tick={{ ...AXIS, fontSize: 11 }} axisLine={false} tickLine={false}
          tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)} />
        <Tooltip cursor={false} content={({ active, payload }) => active && payload?.length ? (
          <div className="rounded-md border border-line bg-white px-3 py-2 text-xs shadow-lg"><b className="tabular-nums">{valueLabel} {fmtAmount(Number(payload[0].value))}</b> <span className="text-ink-soft">{String(payload[0].payload.name)}</span></div>
        ) : null} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}
          onMouseLeave={() => setHover(null)} onMouseEnter={(_, i) => setHover(i)}
          onClick={(d) => { const id = (d as unknown as { id?: string }).id; if (hrefBase && id) router.push(`${hrefBase}/${id}`); }}>
          {data.map((d, i) => <Cell key={i} fill={SERIES[0]} fillOpacity={hover === null || hover === i ? 1 : 0.55} cursor={hrefBase && d.id ? "pointer" : undefined} />)}
          <LabelList dataKey="value" position="right" formatter={(v: number) => fmtCompact(v)} style={{ fontSize: 11, fill: "#52514e" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyChart({ height, hint }: { height: number; hint?: string }) {
  return <div className="grid place-items-center rounded-md border border-dashed border-line text-center text-sm text-ink-muted" style={{ height }}><span>No data for the selected period{hint && <><br /><span className="text-xs">{hint}</span></>}</span></div>;
}

export { Link };
