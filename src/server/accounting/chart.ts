import type { AccountType } from "@prisma/client";

/**
 * System posting accounts. Documents post to the account mapped to each key
 * (Accounting → Chart of accounts → Posting accounts); finance can remap them.
 */
export const POSTING_KEYS = {
  CASH: "Cash receipts and payments",
  BANK: "Bank receipts and payments",
  AR: "Accounts receivable",
  AP: "Accounts payable",
  INVENTORY: "Inventory (stock value)",
  GRNI: "Goods received not invoiced",
  TAX_INPUT: "Input tax on purchases",
  TAX_OUTPUT: "Output tax on sales",
  SALES: "Sales of goods",
  SALES_SERVICE: "Sales of services and non-stock items",
  COGS: "Cost of goods sold",
  PRICE_VARIANCE: "Purchase price variance",
  PURCHASE_EXPENSE: "Purchases of services and non-stock items",
  STOCK_ADJUSTMENT: "Stock adjustments and count differences",
  STOCK_CONSUMPTION: "Internal stock consumption",
  OPENING_BALANCE: "Opening balance equity",
  RETAINED_EARNINGS: "Retained earnings (fiscal year close)",
  ROUNDING: "Rounding differences",
  EXCHANGE_DIFF: "Realised exchange differences",
  WHT_PAYABLE: "Withholding tax payable",
} as const;

export type PostingKey = keyof typeof POSTING_KEYS;

type Row = { code: string; name: string; type: AccountType; parent?: string; group?: boolean; bank?: boolean; key?: PostingKey };

/** Standard chart for a Qatar trading and oilfield-services company. Seeded once into an empty chart. */
export const STANDARD_CHART: Row[] = [
  { code: "1000", name: "Assets", type: "ASSET", group: true },
  { code: "1100", name: "Current assets", type: "ASSET", parent: "1000", group: true },
  { code: "1110", name: "Cash on hand", type: "ASSET", parent: "1100", bank: true, key: "CASH" },
  { code: "1120", name: "Bank - current account", type: "ASSET", parent: "1100", bank: true, key: "BANK" },
  { code: "1130", name: "Accounts receivable", type: "ASSET", parent: "1100", key: "AR" },
  { code: "1140", name: "Inventory", type: "ASSET", parent: "1100", key: "INVENTORY" },
  { code: "1150", name: "Input tax recoverable", type: "ASSET", parent: "1100", key: "TAX_INPUT" },
  { code: "1160", name: "Advances and prepayments", type: "ASSET", parent: "1100" },
  { code: "1200", name: "Non-current assets", type: "ASSET", parent: "1000", group: true },
  { code: "1210", name: "Property, plant and equipment", type: "ASSET", parent: "1200" },
  { code: "1220", name: "Accumulated depreciation", type: "ASSET", parent: "1200" },
  { code: "2000", name: "Liabilities", type: "LIABILITY", group: true },
  { code: "2100", name: "Current liabilities", type: "LIABILITY", parent: "2000", group: true },
  { code: "2110", name: "Accounts payable", type: "LIABILITY", parent: "2100", key: "AP" },
  { code: "2120", name: "Goods received not invoiced", type: "LIABILITY", parent: "2100", key: "GRNI" },
  { code: "2130", name: "Output tax payable", type: "LIABILITY", parent: "2100", key: "TAX_OUTPUT" },
  { code: "2140", name: "Accrued expenses", type: "LIABILITY", parent: "2100" },
  { code: "2150", name: "Customer advances", type: "LIABILITY", parent: "2100" },
  { code: "2160", name: "Withholding tax payable", type: "LIABILITY", parent: "2100", key: "WHT_PAYABLE" },
  { code: "2200", name: "Non-current liabilities", type: "LIABILITY", parent: "2000", group: true },
  { code: "2210", name: "End of service benefits", type: "LIABILITY", parent: "2200" },
  { code: "3000", name: "Equity", type: "EQUITY", group: true },
  { code: "3100", name: "Share capital", type: "EQUITY", parent: "3000" },
  { code: "3200", name: "Retained earnings", type: "EQUITY", parent: "3000", key: "RETAINED_EARNINGS" },
  { code: "3300", name: "Opening balance equity", type: "EQUITY", parent: "3000", key: "OPENING_BALANCE" },
  { code: "4000", name: "Income", type: "INCOME", group: true },
  { code: "4100", name: "Sales - goods", type: "INCOME", parent: "4000", key: "SALES" },
  { code: "4200", name: "Sales - services", type: "INCOME", parent: "4000", key: "SALES_SERVICE" },
  { code: "4900", name: "Other income", type: "INCOME", parent: "4000" },
  { code: "5000", name: "Cost of sales", type: "EXPENSE", group: true },
  { code: "5100", name: "Cost of goods sold", type: "EXPENSE", parent: "5000", key: "COGS" },
  { code: "5200", name: "Purchase price variance", type: "EXPENSE", parent: "5000", key: "PRICE_VARIANCE" },
  { code: "5300", name: "Stock adjustments", type: "EXPENSE", parent: "5000", key: "STOCK_ADJUSTMENT" },
  { code: "5400", name: "Purchases - services and non-stock", type: "EXPENSE", parent: "5000", key: "PURCHASE_EXPENSE" },
  { code: "6000", name: "Operating expenses", type: "EXPENSE", group: true },
  { code: "6100", name: "Salaries and wages", type: "EXPENSE", parent: "6000" },
  { code: "6200", name: "Rent", type: "EXPENSE", parent: "6000" },
  { code: "6300", name: "Utilities and communication", type: "EXPENSE", parent: "6000" },
  { code: "6400", name: "Internal stock consumption", type: "EXPENSE", parent: "6000", key: "STOCK_CONSUMPTION" },
  { code: "6500", name: "Depreciation", type: "EXPENSE", parent: "6000" },
  { code: "6900", name: "Bank charges", type: "EXPENSE", parent: "6000" },
  { code: "6950", name: "Exchange differences", type: "EXPENSE", parent: "6000", key: "EXCHANGE_DIFF" },
  { code: "6990", name: "Rounding differences", type: "EXPENSE", parent: "6000", key: "ROUNDING" },
];
