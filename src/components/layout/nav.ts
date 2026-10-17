import type { Permission } from "@/server/auth/permissions";

export interface NavItem { label: string; href: string; perm: Permission[]; icon: string }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: "Overview", items: [
    { label: "Dashboard", href: "/dashboard", perm: ["dashboard.executive"], icon: "LayoutDashboard" },
    { label: "My approvals", href: "/approvals", perm: ["sales.quotation.approve", "sales.order.approve", "purchase.request.approve", "purchase.order.approve", "inventory.adjust.approve"], icon: "BadgeCheck" },
  ] },
  { label: "Sales", items: [
    { label: "Quotations", href: "/sales/quotations", perm: ["sales.view"], icon: "FileText" },
    { label: "Sales orders", href: "/sales/orders", perm: ["sales.view"], icon: "ShoppingCart" },
    { label: "Deliveries", href: "/sales/deliveries", perm: ["sales.view"], icon: "Truck" },
    { label: "Customers", href: "/customers", perm: ["customer.view"], icon: "Building2" },
  ] },
  { label: "Procurement", items: [
    { label: "Purchase requests", href: "/purchasing/requests", perm: ["purchase.view"], icon: "ClipboardList" },
    { label: "RFQs & offers", href: "/purchasing/rfqs", perm: ["purchase.view"], icon: "Scale" },
    { label: "Purchase orders", href: "/purchasing/orders", perm: ["purchase.view"], icon: "PackageCheck" },
    { label: "Goods receipts", href: "/purchasing/receipts", perm: ["purchase.view"], icon: "PackageOpen" },
    { label: "Suppliers", href: "/suppliers", perm: ["supplier.view"], icon: "Factory" },
  ] },
  { label: "Store & inventory", items: [
    { label: "Items", href: "/inventory/items", perm: ["item.view"], icon: "Boxes" },
    { label: "Stock on hand", href: "/inventory/stock", perm: ["inventory.view"], icon: "Warehouse" },
    { label: "Stock documents", href: "/inventory/documents", perm: ["inventory.view"], icon: "ArrowLeftRight" },
    { label: "Stock counts", href: "/inventory/counts", perm: ["inventory.count", "inventory.adjust.approve"], icon: "ListChecks" },
    { label: "Stock ledger", href: "/inventory/ledger", perm: ["inventory.view"], icon: "BookOpen" },
    { label: "Low stock", href: "/inventory/low-stock", perm: ["inventory.view"], icon: "TriangleAlert" },
    { label: "Batches & serials", href: "/inventory/traceability", perm: ["inventory.view"], icon: "ScanBarcode" },
    { label: "Warehouses & setup", href: "/inventory/setup", perm: ["item.manage"], icon: "Settings2" },
  ] },
  { label: "Finance", items: [
    { label: "Sales invoices", href: "/finance/sales-invoices", perm: ["finance.view"], icon: "Receipt" },
    { label: "Supplier invoices", href: "/finance/purchase-invoices", perm: ["finance.view"], icon: "FileSpreadsheet" },
  ] },
  { label: "Insight", items: [
    { label: "Reports", href: "/reports", perm: ["reports.view", "inventory.view", "audit.view"], icon: "BarChart3" },
  ] },
  { label: "Administration", items: [
    { label: "Users", href: "/admin/users", perm: ["admin.users"], icon: "Users" },
    { label: "Roles & permissions", href: "/admin/roles", perm: ["admin.roles"], icon: "ShieldCheck" },
    { label: "Company settings", href: "/admin/settings", perm: ["admin.settings"], icon: "Building" },
    { label: "Audit trail", href: "/admin/audit", perm: ["audit.view"], icon: "History" },
  ] },
];

export function navFor(perms: ReadonlySet<string>): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.perm.some((p) => perms.has(p))) })).filter((g) => g.items.length);
}
