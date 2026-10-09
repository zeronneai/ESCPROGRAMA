import Decimal from "decimal.js";

export interface PricingFactors {
  /** Porcentaje que se agrega al costo cuando no hay envio (0.04 = 4%). */
  noShippingMarkup: number | string;
  p5: number | string;
  p4: number | string;
  p3: number | string;
  p2: number | string;
  p1: number | string;
}

export const DEFAULT_FACTORS: PricingFactors = {
  noShippingMarkup: "0.04",
  p5: "1.17",
  p4: "1.26",
  p3: "1.35",
  p2: "1.43",
  p1: "1.54",
};

export interface TabuladorResult {
  base: string;
  p1: string;
  p2: string;
  p3: string;
  p4: string;
  p5: string;
}

type Num = number | string | null | undefined;

function toDecimal(v: Num): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  return new Decimal(v);
}

/** Redondeo comercial (mitad hacia arriba) a 2 decimales. */
function round2(d: Decimal): string {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/**
 * Calcula la base y los 5 precios unitarios.
 * - Con envio > 0: base = costo + envio
 * - Sin envio: base = costo * (1 + markup)
 * Los precios se calculan con aritmetica exacta y se redondean solo al final.
 */
export function calcTabulador(
  cost: Num,
  shipping: Num,
  factors: PricingFactors = DEFAULT_FACTORS,
): TabuladorResult {
  const c = toDecimal(cost);
  const s = toDecimal(shipping);
  if (c.isNegative() || s.isNegative()) {
    throw new RangeError("El costo y el envio no pueden ser negativos");
  }
  const base = s.greaterThan(0)
    ? c.plus(s)
    : c.times(new Decimal(1).plus(toDecimal(factors.noShippingMarkup)));
  const price = (f: Num) => round2(base.times(toDecimal(f)));
  return {
    base: round2(base),
    p5: price(factors.p5),
    p4: price(factors.p4),
    p3: price(factors.p3),
    p2: price(factors.p2),
    p1: price(factors.p1),
  };
}

/** Total por cantidad (precio unitario ya redondeado por cantidad). */
export function lineTotal(unitPrice: Num, quantity: Num): string {
  return round2(toDecimal(unitPrice).times(toDecimal(quantity)));
}
