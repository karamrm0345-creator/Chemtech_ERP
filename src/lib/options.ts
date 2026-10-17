import { humanize } from "./format";

export const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: humanize(v) }));

export const CUSTOMER_CATEGORIES = ["OPERATOR", "EPC_CONTRACTOR", "INDUSTRIAL", "TRADING", "GOVERNMENT", "OTHER"] as const;
export const CUSTOMER_CATEGORY_LABEL: Record<string, string> = {
  OPERATOR: "Oil & gas operator", EPC_CONTRACTOR: "EPC contractor", INDUSTRIAL: "Industrial client", TRADING: "Trading company", GOVERNMENT: "Government / semi-government", OTHER: "Other",
};
export const SUPPLIER_CATEGORIES = ["MANUFACTURER", "DISTRIBUTOR", "SERVICE_PROVIDER", "LOGISTICS", "CONTRACTOR", "OTHER"] as const;
export const PREQUAL = ["NOT_STARTED", "PENDING", "APPROVED", "CONDITIONAL", "REJECTED", "EXPIRED"] as const;
export const ITEM_TYPES = ["PRODUCT", "CHEMICAL", "EQUIPMENT", "SPARE_PART", "CONSUMABLE", "SERVICE"] as const;
export const INVENTORY_CLASS_LABEL: Record<string, string> = {
  STOCK: "Stock (quantity tracked)", SERIALIZED_ASSET: "Serialized asset", RENTAL: "Rental equipment (serialized)", NON_STOCK: "Non-stock / expensed",
};
export const COUNTRIES = ["Qatar", "Saudi Arabia", "United Arab Emirates", "Kuwait", "Oman", "Bahrain", "United Kingdom", "United States", "Germany", "Italy", "France", "Netherlands", "Norway", "India", "China", "Singapore", "Malaysia", "Japan", "South Korea", "Other"];
