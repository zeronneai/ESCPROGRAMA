import Decimal from "decimal.js";

/**
 * Envio al cliente DENTRO del precio unitario.
 *
 * El envio se suma al precio ELEGIDO de cada partida (nunca cambia los 5 precios ni las respuestas
 * del comprador). Reglas:
 *  - Cantidad: si la partida no tiene cantidad numerica (solo talla), se trata como 1.
 *  - Se calcula el incremento POR UNIDAD de cada partida y se redondea a 2 decimales (mitad hacia arriba).
 *  - Precio unitario final = precio elegido + incremento. Importe de la partida = precio unitario final x cantidad.
 *  - Solo se afectan las partidas de la moneda del plan (si la solicitud mezcla pesos y dolares).
 *
 * Modos:
 *  - "incluido":    sin cargo de envio; los precios no cambian.
 *  - "por_unidad":  mismo monto sumado al precio de cada unidad de cada partida.
 *  - "por_pedido":  un monto total repartido entre las partidas proporcionalmente a su importe
 *                   (precio elegido x cantidad) y, dentro de cada partida, entre sus unidades.
 *  - "por_partida": un monto por partida, "por unidad" o "total de la partida" (se divide entre la cantidad).
 *
 * REDONDEO en "por_pedido" (metodo del resto / largest remainder): el incremento por unidad se trunca a
 * centavos y los centavos que faltan para llegar al monto total se reparten, de uno en uno, a las partidas con
 * mayor resto (desempate: mayor importe, luego orden). Como el incremento es por unidad, agregar 1 centavo a una
 * partida suma `cantidad` centavos al envio total; solo se agrega si deja el total mas cerca del monto. Por eso el
 * envio repartido puede diferir del monto exacto por unos centavos (ver `diferencia`).
 */

export type Currency = "MXN" | "USD";

export interface AllocLine {
  id: string;
  moneda: Currency;
  /** Cantidad solicitada; null, vacia, 0 o no numerica = 1. */
  cantidad?: Decimal.Value | null;
  /** Precio unitario ELEGIDO por el vendedor (sin envio). */
  precioElegido: Decimal.Value;
}

export type PartidaShipping = { monto: Decimal.Value; tipo: "unidad" | "total" };

export type ShippingPlan =
  | { modo: "incluido" }
  | { modo: "por_unidad"; monto: Decimal.Value; moneda: Currency }
  | { modo: "por_pedido"; monto: Decimal.Value; moneda: Currency }
  | { modo: "por_partida"; moneda: Currency; partidas: Record<string, PartidaShipping> };

export const NO_SHIPPING: ShippingPlan = { modo: "incluido" };

export interface AllocResult {
  id: string;
  moneda: Currency;
  cantidad: Decimal;
  precioElegido: Decimal;
  /** Incremento por unidad (redondeado a 2 decimales). */
  incremento: Decimal;
  /** Precio elegido + incremento. */
  precioUnitario: Decimal;
  /** Precio unitario final x cantidad. */
  importe: Decimal;
  /** Envio incluido en la partida = incremento x cantidad. */
  envio: Decimal;
}

export interface AllocSummary {
  lines: AllocResult[];
  moneda: Currency | null;
  /** Monto pedido por el vendedor en "por_pedido"; null en los demas modos. */
  solicitado: Decimal | null;
  /** Envio realmente incluido en los precios (suma de incremento x cantidad). */
  repartido: Decimal;
  /** repartido - solicitado en "por_pedido" (puede diferir por centavos); null en los demas modos. */
  diferencia: Decimal | null;
}

const D = (v: Decimal.Value) => new Decimal(v);
const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Cantidad efectiva: numerica y mayor a 0; si no, 1. */
export function effectiveQuantity(q: Decimal.Value | null | undefined): Decimal {
  if (q === null || q === undefined || q === "") return D(1);
  try {
    const d = D(q);
    return d.isFinite() && d.greaterThan(0) ? d : D(1);
  } catch {
    return D(1);
  }
}

export function allocateShipping(input: AllocLine[], plan: ShippingPlan): AllocSummary {
  const base = input.map((l) => {
    const cantidad = effectiveQuantity(l.cantidad);
    const precioElegido = D(l.precioElegido);
    return { l, cantidad, precioElegido, importeBase: precioElegido.times(cantidad), inc: D(0) };
  });

  const inCurrency = (moneda: Currency) => base.filter((b) => b.l.moneda === moneda);
  let solicitado: Decimal | null = null;
  let moneda: Currency | null = null;

  if (plan.modo === "por_unidad") {
    moneda = plan.moneda;
    const monto = round2(D(plan.monto));
    if (monto.greaterThan(0)) for (const b of inCurrency(plan.moneda)) b.inc = monto;
  } else if (plan.modo === "por_partida") {
    moneda = plan.moneda;
    for (const b of inCurrency(plan.moneda)) {
      const p = plan.partidas[b.l.id];
      if (!p) continue;
      const monto = D(p.monto);
      if (!monto.greaterThan(0)) continue;
      b.inc = p.tipo === "unidad" ? round2(monto) : round2(monto.div(b.cantidad));
    }
  } else if (plan.modo === "por_pedido") {
    moneda = plan.moneda;
    const monto = round2(D(plan.monto));
    solicitado = monto;
    const target = inCurrency(plan.moneda);
    const total = target.reduce((a, b) => a.plus(b.importeBase), D(0));
    if (monto.greaterThan(0) && total.greaterThan(0)) {
      // Incremento exacto por unidad, en centavos: monto x (importe / total) / cantidad x 100.
      const work = target.map((b, index) => {
        const exactCents = monto.times(b.importeBase).div(total).div(b.cantidad).times(100);
        const floorCents = exactCents.floor();
        return { b, index, floorCents, rem: exactCents.minus(floorCents) };
      });
      let missing = monto.times(100).minus(work.reduce((a, w) => a.plus(w.floorCents.times(w.b.cantidad)), D(0)));
      const order = [...work].sort(
        (x, y) => y.rem.comparedTo(x.rem) || y.b.importeBase.comparedTo(x.b.importeBase) || x.index - y.index,
      );
      for (const w of order) {
        if (missing.lessThanOrEqualTo(0)) break;
        if (w.rem.isZero()) continue;
        // Sumar 1 centavo a esta partida agrega `cantidad` centavos al envio total: solo si lo acerca al monto.
        if (missing.minus(w.b.cantidad).abs().lessThan(missing.abs())) {
          w.floorCents = w.floorCents.plus(1);
          missing = missing.minus(w.b.cantidad);
        }
      }
      for (const w of work) w.b.inc = w.floorCents.div(100);
    }
  }

  const lines: AllocResult[] = base.map((b) => {
    const precioUnitario = b.precioElegido.plus(b.inc);
    return {
      id: b.l.id,
      moneda: b.l.moneda,
      cantidad: b.cantidad,
      precioElegido: b.precioElegido,
      incremento: b.inc,
      precioUnitario,
      importe: round2(precioUnitario.times(b.cantidad)),
      envio: round2(b.inc.times(b.cantidad)),
    };
  });
  const repartido = lines.reduce((a, l) => a.plus(l.envio), D(0));
  return { lines, moneda, solicitado, repartido, diferencia: solicitado ? repartido.minus(solicitado) : null };
}

/** Total por moneda (suma de los importes). Nunca mezcla pesos y dolares. */
export function totalsByCurrency(lines: AllocResult[]): { moneda: Currency; total: Decimal; envio: Decimal }[] {
  return (["MXN", "USD"] as const)
    .map((moneda) => {
      const mine = lines.filter((l) => l.moneda === moneda);
      return {
        moneda,
        total: mine.reduce((a, l) => a.plus(l.importe), D(0)),
        envio: mine.reduce((a, l) => a.plus(l.envio), D(0)),
        n: mine.length,
      };
    })
    .filter((t) => t.n > 0)
    .map(({ moneda, total, envio }) => ({ moneda, total, envio }));
}
