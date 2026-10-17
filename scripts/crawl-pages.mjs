// Dev smoke test: signs in and opens every page type (lists, details, forms, tabs, reports),
// reporting HTTP errors, error boundaries, browser exceptions and unexpected redirects.
// Usage: node scripts/crawl-pages.mjs <email> <password> [baseUrl]
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";

const [, , email, pw, B = "http://localhost:3000"] = process.argv;
const prisma = new PrismaClient();
const ids = async (model, where = {}, n = 2) => (await prisma[model].findMany({ where, select: { id: true }, take: n })).map((r) => r.id);
const P = ["/dashboard", "/approvals", "/admin/users", "/admin/roles", "/admin/roles/new", "/admin/settings", "/admin/audit", "/inventory/setup", "/inventory/items", "/inventory/stock",
  "/inventory/documents", "/inventory/counts", "/inventory/ledger", "/inventory/low-stock", "/inventory/traceability", "/inventory/traceability?tab=serials",
  "/purchasing/requests", "/purchasing/rfqs", "/purchasing/rfqs?tab=offers", "/purchasing/orders", "/purchasing/receipts", "/sales/quotations", "/sales/orders", "/sales/deliveries",
  "/customers", "/suppliers", "/finance/sales-invoices", "/finance/purchase-invoices", "/reports", "/account/password",
  "/customers/new", "/suppliers/new", "/inventory/items/new", "/sales/quotations/new", "/sales/orders/new", "/purchasing/requests/new", "/purchasing/orders/new",
  "/purchasing/rfqs/new", "/purchasing/supplier-quotations/new", "/inventory/documents/new"];
const detail = { customer: "/customers", supplier: "/suppliers", item: "/inventory/items", salesQuotation: "/sales/quotations", salesOrder: "/sales/orders", deliveryOrder: "/sales/deliveries",
  purchaseRequest: "/purchasing/requests", rfq: "/purchasing/rfqs", supplierQuotation: "/purchasing/supplier-quotations", purchaseOrder: "/purchasing/orders", goodsReceipt: "/purchasing/receipts",
  purchaseReturn: "/purchasing/returns", stockDocument: "/inventory/documents", stockCount: "/inventory/counts", salesInvoice: "/finance/sales-invoices", purchaseInvoice: "/finance/purchase-invoices", role: "/admin/roles" };
for (const [m, base] of Object.entries(detail)) for (const id of await ids(m)) P.push(`${base}/${id}`);
const [c] = await ids("customer", {}, 1), [s] = await ids("supplier", {}, 1), [it] = await ids("item", { serialTracked: true }, 1);
if (c) for (const t of ["contacts", "quotations", "orders", "deliveries", "invoices", "documents"]) P.push(`/customers/${c}?tab=${t}`);
if (s) for (const t of ["contacts", "compliance", "quotations", "orders", "receipts", "invoices", "quality", "documents"]) P.push(`/suppliers/${s}?tab=${t}`);
if (it) for (const t of ["card", "serials", "documents"]) P.push(`/inventory/items/${it}?tab=${t}`);
for (const k of ["sales-by-period", "sales-by-customer", "sales-order-status", "quotation-conversion", "purchases-by-supplier", "purchase-order-status", "supplier-delivery-performance",
  "stock-on-hand", "stock-valuation", "low-stock", "slow-moving", "stock-ledger", "stock-adjustments", "expiring", "pending-approvals", "audit-trail"]) P.push(`/reports/${k}`);
const [so] = await ids("salesOrder", { status: { in: ["APPROVED", "PARTIALLY_DELIVERED"] } }, 1);
const [po] = await ids("purchaseOrder", { status: { in: ["PARTIALLY_RECEIVED", "RECEIVED"] } }, 1);
if (so) P.push(`/sales/deliveries/new?salesOrderId=${so}`, `/finance/sales-invoices/new?salesOrderId=${so}`);
if (po) P.push(`/purchasing/receipts/new?purchaseOrderId=${po}`, `/purchasing/returns/new?purchaseOrderId=${po}`, `/finance/purchase-invoices/new?purchaseOrderId=${po}`);
await prisma.$disconnect();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
await page.goto(B + "/login");
await page.fill("input[name=email]", email); await page.fill("input[name=password]", pw);
await page.click('button:has-text("Sign in")'); await page.waitForURL((u) => !u.pathname.startsWith("/login"));
let ok = 0, forbidden = 0, bad = 0;
for (const p of P) {
  errs.length = 0;
  let status = 0;
  try { status = (await page.goto(B + p, { waitUntil: "load" }))?.status() ?? 0; } catch { await page.waitForLoadState("load").catch(() => {}); }
  const body = (await page.innerText("body").catch(() => "")) ?? "";
  const where = page.url().replace(B, "");
  if (where.startsWith("/forbidden") || body.includes("Access restricted")) { forbidden++; if (process.env.SHOW_FORBIDDEN) console.log("forbidden", p); continue; }
  if (status >= 400 || /Something went wrong|Application error|Unhandled Runtime Error|Record not found/.test(body) || errs.length) {
    bad++; console.log("PROBLEM", status, p, "->", where, errs.join(" | "));
  } else ok++;
}
console.log(`pages ok=${ok} forbidden(by role)=${forbidden} problems=${bad} of ${P.length}`);
await browser.close();
process.exit(bad ? 1 : 0);
