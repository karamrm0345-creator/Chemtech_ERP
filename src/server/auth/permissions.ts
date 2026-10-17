// Permission catalog. Roles are configurable in the database; this catalog
// defines what can be granted. Every protected server action checks one.
export const PERMISSION_GROUPS = {
  Dashboard: {
    "dashboard.executive": "View executive dashboard",
    "dashboard.financial": "View financial KPIs (receivables / payables)",
  },
  Customers: {
    "customer.view": "View customers",
    "customer.manage": "Create / edit customers",
  },
  Suppliers: {
    "supplier.view": "View suppliers",
    "supplier.manage": "Create / edit suppliers",
    "supplier.bank.view": "View supplier bank details",
    "supplier.bank.manage": "Edit supplier bank details",
  },
  Items: {
    "item.view": "View items and stock",
    "item.manage": "Create / edit items, categories, UoM, warehouses",
  },
  Sales: {
    "sales.view": "View sales documents",
    "sales.quotation.manage": "Prepare quotations",
    "sales.quotation.approve": "Approve quotations",
    "sales.order.manage": "Prepare sales orders",
    "sales.order.approve": "Approve sales orders",
    "sales.reserve": "Reserve / release stock for orders",
    "sales.delivery.manage": "Prepare delivery orders",
    "sales.delivery.post": "Post delivery orders (issue stock)",
  },
  Procurement: {
    "purchase.view": "View procurement documents",
    "purchase.request.manage": "Create purchase requests",
    "purchase.request.approve": "Approve purchase requests",
    "purchase.rfq.manage": "Manage RFQs and supplier quotations",
    "purchase.order.manage": "Prepare purchase orders",
    "purchase.order.approve": "Approve purchase orders",
    "purchase.receipt.manage": "Prepare goods receipts",
    "purchase.receipt.post": "Post goods receipts (receive stock)",
    "purchase.return.manage": "Create and post purchase returns",
  },
  Inventory: {
    "inventory.view": "View stock ledger and balances",
    "inventory.adjust": "Prepare stock adjustments / opening balances",
    "inventory.adjust.approve": "Approve and post stock adjustments",
    "inventory.transfer": "Transfer stock between warehouses",
    "inventory.issue": "Issue stock internally",
    "inventory.count": "Perform physical stock counts",
    "inventory.negative": "Override negative stock prevention",
  },
  Finance: {
    "finance.view": "View invoices and payments",
    "finance.sales.manage": "Issue sales invoices and record receipts",
    "finance.purchase.manage": "Record supplier invoices and payments",
  },
  Reports: {
    "reports.view": "View operational reports",
    "reports.export": "Export reports",
  },
  Administration: {
    "admin.users": "Manage users",
    "admin.roles": "Manage roles and permissions",
    "admin.settings": "Manage company settings, numbering, currencies",
    "audit.view": "View audit trail",
    "attachment.upload": "Upload attachments",
    "attachment.delete": "Delete attachments",
  },
} as const;

type Groups = typeof PERMISSION_GROUPS;
export type Permission = { [G in keyof Groups]: keyof Groups[G] }[keyof Groups];

export const ALL_PERMISSIONS = Object.values(PERMISSION_GROUPS).flatMap((g) => Object.keys(g)) as Permission[];

const view = ["customer.view", "supplier.view", "item.view", "sales.view", "purchase.view", "inventory.view", "reports.view"] as const;

/** Default role templates used by the base seed. Admins can change them later. */
export const DEFAULT_ROLES: { code: string; name: string; description: string; permissions: Permission[] }[] = [
  {
    code: "GENERAL_MANAGER", name: "General Manager", description: "Executive overview and final approvals",
    permissions: [...view, "dashboard.executive", "dashboard.financial", "finance.view", "reports.export", "audit.view",
      "sales.quotation.approve", "sales.order.approve", "purchase.request.approve", "purchase.order.approve",
      "inventory.adjust.approve", "supplier.bank.view", "attachment.upload"],
  },
  {
    code: "SALES_MANAGER", name: "Sales Manager", description: "Manages and approves sales",
    permissions: [...view, "dashboard.executive", "customer.manage", "sales.quotation.manage", "sales.quotation.approve",
      "sales.order.manage", "sales.order.approve", "sales.reserve", "sales.delivery.manage", "purchase.request.manage",
      "reports.export", "attachment.upload", "finance.view"],
  },
  {
    code: "SALES_OFFICER", name: "Sales Officer", description: "Prepares quotations and orders",
    permissions: ["customer.view", "item.view", "sales.view", "inventory.view", "customer.manage", "sales.quotation.manage",
      "sales.order.manage", "sales.reserve", "sales.delivery.manage", "purchase.request.manage", "attachment.upload"],
  },
  {
    code: "PROCUREMENT_MANAGER", name: "Procurement Manager", description: "Manages and approves procurement",
    permissions: [...view, "dashboard.executive", "supplier.manage", "supplier.bank.view", "purchase.request.manage",
      "purchase.request.approve", "purchase.rfq.manage", "purchase.order.manage", "purchase.order.approve",
      "purchase.return.manage", "reports.export", "attachment.upload", "finance.view"],
  },
  {
    code: "PROCUREMENT_OFFICER", name: "Procurement Officer", description: "Prepares RFQs and purchase orders",
    permissions: ["supplier.view", "item.view", "purchase.view", "inventory.view", "supplier.manage", "purchase.request.manage",
      "purchase.rfq.manage", "purchase.order.manage", "attachment.upload"],
  },
  {
    code: "STORE_MANAGER", name: "Store Manager", description: "Controls warehouses and approves adjustments",
    permissions: [...view, "item.manage", "inventory.adjust", "inventory.adjust.approve", "inventory.transfer", "inventory.issue",
      "inventory.count", "purchase.receipt.manage", "purchase.receipt.post", "purchase.return.manage", "sales.delivery.manage",
      "sales.delivery.post", "sales.reserve", "purchase.request.manage", "reports.export", "attachment.upload"],
  },
  {
    code: "STOREKEEPER", name: "Storekeeper", description: "Records receipts, issues and counts",
    permissions: ["item.view", "inventory.view", "purchase.view", "sales.view", "inventory.adjust", "inventory.transfer",
      "inventory.issue", "inventory.count", "purchase.receipt.manage", "purchase.receipt.post", "sales.delivery.manage",
      "sales.delivery.post", "attachment.upload"],
  },
  {
    code: "FINANCE_OFFICER", name: "Finance Officer", description: "Invoices, receipts and supplier payments",
    permissions: [...view, "dashboard.financial", "finance.view", "finance.sales.manage", "finance.purchase.manage",
      "supplier.bank.view", "reports.export", "attachment.upload"],
  },
  {
    code: "SYSTEM_ADMIN", name: "System Administrator", description: "Users, roles and settings (no business approvals)",
    permissions: [...view, "admin.users", "admin.roles", "admin.settings", "audit.view", "item.manage", "attachment.upload", "attachment.delete"],
  },
  {
    code: "AUDITOR", name: "Read-Only Auditor", description: "Read-only access including audit trail",
    permissions: [...view, "dashboard.executive", "dashboard.financial", "finance.view", "audit.view", "reports.export"],
  },
];
