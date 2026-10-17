import { Prisma } from "@prisma/client";

export const Decimal = Prisma.Decimal;
export type Dec = Prisma.Decimal;

export function D(v: Prisma.Decimal.Value | null | undefined): Prisma.Decimal {
  if (v === null || v === undefined || v === "") return new Prisma.Decimal(0);
  return new Prisma.Decimal(v);
}

export const ZERO = new Prisma.Decimal(0);

export function round2(v: Prisma.Decimal): Prisma.Decimal {
  return v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function round4(v: Prisma.Decimal): Prisma.Decimal {
  return v.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

export function num(v: Prisma.Decimal.Value | null | undefined): number {
  return D(v).toNumber();
}

export interface LineInput {
  quantity: Prisma.Decimal.Value;
  unitPrice: Prisma.Decimal.Value;
  discountPct?: Prisma.Decimal.Value | null;
  taxRate?: Prisma.Decimal.Value | null;
}

/** Shared line maths for every commercial document. */
export function calcLine(l: LineInput) {
  const gross = D(l.quantity).mul(D(l.unitPrice));
  const discount = round2(gross.mul(D(l.discountPct)).div(100));
  const lineTotal = round2(gross).sub(discount);
  const taxAmount = round2(lineTotal.mul(D(l.taxRate)).div(100));
  return { gross: round2(gross), discount, lineTotal, taxAmount };
}

export function calcTotals(lines: LineInput[], extra: Prisma.Decimal.Value = 0) {
  let subtotal = ZERO, discountTotal = ZERO, taxTotal = ZERO;
  for (const l of lines) {
    const c = calcLine(l);
    subtotal = subtotal.add(c.gross);
    discountTotal = discountTotal.add(c.discount);
    taxTotal = taxTotal.add(c.taxAmount);
  }
  const total = subtotal.sub(discountTotal).add(taxTotal).add(D(extra));
  return { subtotal, discountTotal, taxTotal, total };
}
