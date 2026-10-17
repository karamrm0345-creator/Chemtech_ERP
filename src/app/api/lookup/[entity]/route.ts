import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";

/** Typeahead lookups for pickers. Requires a session and the matching view permission. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { entity } = await params;
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  const contains = { contains: q, mode: "insensitive" as const };
  const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (entity === "items") {
    if (!user.permissions.has("item.view")) return deny();
    const stockOnly = req.nextUrl.searchParams.get("stock") === "1";
    const rows = await prisma.item.findMany({
      where: { active: true, ...(stockOnly ? { itemType: { not: "SERVICE" }, inventoryClass: { not: "NON_STOCK" } } : {}), ...(q ? { OR: [{ code: contains }, { name: contains }, { manufacturerPartNo: contains }] } : {}) },
      include: { uom: true }, take: 25, orderBy: { code: "asc" },
    });
    return NextResponse.json(rows.map((i) => ({
      id: i.id, label: `${i.code} — ${i.name}`, sub: `${i.itemType.replace("_", " ").toLowerCase()} · ${i.uom.code}${i.manufacturerPartNo ? ` · MPN ${i.manufacturerPartNo}` : ""}`,
      data: { name: i.name, uom: i.uom.code, sellingPrice: i.sellingPrice.toString(), purchasePrice: i.purchasePrice.toString(), batchTracked: i.batchTracked, serialTracked: i.serialTracked, expiryTracked: i.expiryTracked },
    })));
  }
  if (entity === "customers") {
    if (!user.permissions.has("customer.view")) return deny();
    const rows = await prisma.customer.findMany({ where: { active: true, ...(q ? { OR: [{ code: contains }, { legalName: contains }, { tradingName: contains }] } : {}) }, take: 25, orderBy: { legalName: "asc" } });
    return NextResponse.json(rows.map((c) => ({ id: c.id, label: c.legalName, sub: `${c.code} · ${c.category.replace("_", " ").toLowerCase()}`, data: { currency: c.currency, paymentTerms: c.paymentTerms ?? "", address: c.address ?? "" } })));
  }
  if (entity === "suppliers") {
    if (!user.permissions.has("supplier.view")) return deny();
    const rows = await prisma.supplier.findMany({ where: { active: true, prequalStatus: { not: "REJECTED" }, ...(q ? { OR: [{ code: contains }, { legalName: contains }, { productsServices: contains }] } : {}) }, take: 25, orderBy: { legalName: "asc" } });
    return NextResponse.json(rows.map((s) => ({ id: s.id, label: s.legalName, sub: `${s.code} · ${s.prequalStatus.replace("_", " ").toLowerCase()}`, data: { currency: s.currency, paymentTerms: s.paymentTerms ?? "" } })));
  }
  if (entity === "contacts") {
    if (!user.permissions.has("customer.view")) return deny();
    const customerId = req.nextUrl.searchParams.get("customerId") ?? "";
    const rows = await prisma.customerContact.findMany({ where: { customerId }, orderBy: { isPrimary: "desc" } });
    return NextResponse.json(rows.map((c) => ({ id: c.id, label: c.name, sub: [c.title, c.email].filter(Boolean).join(" · ") })));
  }
  if (entity === "users") {
    if (!user.permissions.has("customer.view") && !user.permissions.has("admin.users")) return deny();
    const rows = await prisma.user.findMany({ where: { active: true, ...(q ? { OR: [{ name: contains }, { email: contains }] } : {}) }, take: 25, orderBy: { name: "asc" } });
    return NextResponse.json(rows.map((u) => ({ id: u.id, label: u.name, sub: u.email })));
  }
  return NextResponse.json({ error: "Unknown lookup" }, { status: 404 });
}
