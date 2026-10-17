import type { ReportParams } from "@/server/services/reports";
import { dateRange, str, type SP } from "./params";

export function reportParams(sp: SP): ReportParams {
  const { from, to } = dateRange(sp);
  const days = Number(str(sp, "days") ?? "") || undefined;
  return { from, to, customerId: str(sp, "customerId"), supplierId: str(sp, "supplierId"), warehouseId: str(sp, "warehouseId"), categoryId: str(sp, "categoryId"), status: str(sp, "status"), days, q: str(sp, "q") };
}
