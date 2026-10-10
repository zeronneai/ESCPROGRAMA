import { UNIDADES } from "@/lib/validation/request";

/**
 * Compra minima de una cotizacion. Siempre existe: cantidad >= 1 y unidad (1 = se puede comprar desde 1 pieza).
 * Las cotizaciones anteriores a la regla (sin cantidad) se asumen con minimo 1 sin modificar nada bloqueado.
 */
export interface MinQuote {
  moneda?: "MXN" | "USD";
  compra_min_cantidad: number | string | null;
  compra_min_unidad: string | null;
  compra_min_monto: number | string | null;
}

export interface EffectiveMin {
  cantidad: number;
  unidad: string;
  /** Condicion adicional opcional (cotizaciones que se guardaron por monto). */
  monto: number | null;
}

export type MinDecision = "cotizar_minimo" | "mantener_pedida";

export const MIN_DECISION_LABEL: Record<MinDecision, string> = {
  cotizar_minimo: "Cotizar a la cantidad mínima",
  mantener_pedida: "Mantener la cantidad pedida",
};

/** Unidad por defecto del formulario: la de la partida si es una unidad conocida, o "pieza". */
export function defaultMinUnit(unidadPartida: string | null | undefined): string {
  return unidadPartida && (UNIDADES as readonly string[]).includes(unidadPartida) ? unidadPartida : "pieza";
}

export function effectiveMin(q: MinQuote, unidadPartida?: string | null): EffectiveMin {
  const c = q.compra_min_cantidad === null || q.compra_min_cantidad === "" ? NaN : Number(q.compra_min_cantidad);
  const monto = q.compra_min_monto === null || q.compra_min_monto === "" ? 0 : Number(q.compra_min_monto);
  return {
    cantidad: Number.isFinite(c) && c >= 1 ? c : 1,
    unidad: q.compra_min_unidad?.trim() || defaultMinUnit(unidadPartida),
    monto: monto > 0 ? monto : null,
  };
}

const money = (n: number, moneda?: string) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${moneda ? ` ${moneda}` : ""}`;

/** Texto de la compra minima para el vendedor (siempre visible, aun con minimo 1). */
export function describeMin(q: MinQuote, unidadPartida?: string | null): string {
  const m = effectiveMin(q, unidadPartida);
  return `${m.cantidad} ${m.unidad}${m.monto ? ` / ${money(m.monto, q.moneda)}` : ""}`;
}

/** Condicion que el cliente debe ver: solo cuando el minimo es mayor a 1 (o hay monto minimo). Si no, null. */
export function minCondition(q: MinQuote, unidadPartida?: string | null): string | null {
  const m = effectiveMin(q, unidadPartida);
  const parts: string[] = [];
  if (m.cantidad > 1) parts.push(`${m.cantidad} ${m.unidad}`);
  if (m.monto) parts.push(money(m.monto, q.moneda));
  return parts.length ? parts.join(" / ") : null;
}

export interface MinAlert {
  pedida: number;
  minima: number;
  unidad: string;
  text: string;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Alerta cuando la cantidad pedida es menor que el minimo y la unidad es la misma. */
export function minAlert(
  item: { cantidad: number | string | null; unidad: string | null },
  q: MinQuote,
): MinAlert | null {
  const pedida = item.cantidad === null || item.cantidad === "" ? NaN : Number(item.cantidad);
  if (!(pedida > 0)) return null;
  const m = effectiveMin(q, item.unidad);
  if (norm(m.unidad) !== norm(item.unidad)) return null;
  if (!(pedida < m.cantidad)) return null;
  return { pedida, minima: m.cantidad, unidad: m.unidad, text: `Cantidad pedida (${pedida} ${m.unidad}) menor al mínimo (${m.cantidad} ${m.unidad})` };
}

/** Cantidad con la que se cotiza en el PDF segun la decision del vendedor. */
export function pdfQuantity(
  item: { cantidad: number | string | null; unidad: string | null },
  q: MinQuote,
  decision: MinDecision | null | undefined,
): number | string | null {
  const a = minAlert(item, q);
  return a && decision === "cotizar_minimo" ? a.minima : item.cantidad;
}
