import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getSessionUser } from "@/server/auth/session";
import { runReport } from "@/server/services/reports";
import { AppError } from "@/server/errors";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { reportParams } from "@/lib/report-params";
import { formatCell } from "@/lib/report-format";

/** CSV / Excel export of any report, enforcing the report's permission + reports.export. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.permissions.has("reports.export")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { key } = await params;
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  try {
    const out = await runReport(user, key, reportParams(sp));
    if (!out) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
    const { def, result } = out;
    await audit(prisma, user, { action: "EXPORT", entity: "Report", entityId: key, summary: `Exported ${def.title} (${result.rows.length} rows)` });
    const stamp = new Date().toISOString().slice(0, 10);
    if (sp.format === "csv") {
      // Prefix formula-leading cells to prevent CSV/formula injection in spreadsheet apps.
      const esc = (v: string) => { const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const lines = [result.columns.map((c) => esc(c.label)).join(","), ...result.rows.map((r) => result.columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined) return "";
        if (typeof v === "number") return String(v);
        if (v instanceof Date) return v.toISOString();
        return esc(String(v));
      }).join(","))];
      return new NextResponse("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${key}-${stamp}.csv"`, "Cache-Control": "no-store" } });
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = "Chemtech ERP";
    const ws = wb.addWorksheet(def.title.slice(0, 31));
    ws.addRow([def.title]).font = { bold: true, size: 14 };
    ws.addRow([`Generated ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Qatar" })} by ${user.userName}`]).font = { italic: true, color: { argb: "FF666666" } };
    ws.addRow([]);
    const header = ws.addRow(result.columns.map((c) => c.label));
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F6FE5" } }; });
    for (const r of result.rows) {
      ws.addRow(result.columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined) return null;
        if (c.type === "money" || c.type === "qty" || c.type === "int" || c.type === "pct") return Number(v);
        if (v instanceof Date) return v;
        return formatCell(v, c.type);
      }));
    }
    if (result.totals) ws.addRow(result.columns.map((c, i) => (i === 0 ? "Total" : result.totals![c.key] ?? null))).font = { bold: true };
    result.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.min(Math.max(c.label.length + 4, 12), 48);
      if (c.type === "money") col.numFmt = "#,##0.00";
      if (c.type === "date") col.numFmt = "dd-mmm-yyyy";
      if (c.type === "datetime") col.numFmt = "dd-mmm-yyyy hh:mm";
    });
    ws.views = [{ state: "frozen", ySplit: 4 }];
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buf as ArrayBuffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${key}-${stamp}.xlsx"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "FORBIDDEN" ? 403 : 400 });
    console.error("[export]", e);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
