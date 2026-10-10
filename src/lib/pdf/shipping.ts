import { NO_SHIPPING, type Currency, type ShippingPlan } from "@/lib/pricing/shipping-allocation";
import { parseNumber } from "@/lib/validation/request";

export type ShippingMode = "incluido" | "por_unidad" | "por_pedido" | "por_partida";
export type ShippingCurrency = Currency;

export const SHIPPING_MODE_LABEL: Record<ShippingMode, string> = {
  incluido: "Sin envío",
  por_unidad: "Por unidad",
  por_pedido: "Por todo el pedido",
  por_partida: "Por partida",
};

/** Lo que captura el vendedor en el panel (todo texto). */
export interface ShippingInput {
  modo: ShippingMode;
  monto?: string | null;
  moneda?: string | null;
  partidas?: { itemId: string; monto: string; tipo: "unidad" | "total" }[];
}

export interface ShippingDb {
  modo: ShippingMode;
  monto: number | null;
  moneda: Currency | null;
  partidas: { item_id: string; monto: number; tipo: "unidad" | "total" }[];
}

export type ShippingParse = { ok: true; plan: ShippingPlan; db: ShippingDb } | { ok: false; error: string };

const MIXED_ERROR = "Elige la moneda del envío (la solicitud mezcla pesos y dólares)";

function resolveCurrency(chosen: string | null | undefined, currencies: Currency[]): Currency | null {
  if (chosen === "MXN" || chosen === "USD") return chosen;
  return currencies.length === 1 ? currencies[0] : null;
}

/**
 * Convierte la captura del vendedor en un plan de envio.
 * - Monto vacio o 0 = sin envio (el precio no cambia).
 * - Moneda: la elegida; si no hay y las partidas usan una sola, esa; si mezcla pesos y dolares, hay que elegirla.
 * - Por partida: solo cuentan partidas de la lista dada con monto mayor a 0.
 */
export function parseShippingPlan(
  input: ShippingInput,
  ctx: { currencies: Currency[]; itemIds: string[] },
): ShippingParse {
  const none: ShippingParse = { ok: true, plan: NO_SHIPPING, db: { modo: "incluido", monto: null, moneda: null, partidas: [] } };
  if (input.modo === "incluido") return none;

  if (input.modo === "por_unidad" || input.modo === "por_pedido") {
    const n = parseNumber(input.monto ?? "");
    if (n === undefined || n === 0) return none;
    if (Number.isNaN(n) || n < 0) return { ok: false, error: "El monto del envío no es válido" };
    const moneda = resolveCurrency(input.moneda, ctx.currencies);
    if (!moneda) return { ok: false, error: MIXED_ERROR };
    return { ok: true, plan: { modo: input.modo, monto: n, moneda }, db: { modo: input.modo, monto: n, moneda, partidas: [] } };
  }

  // por_partida
  const partidas: ShippingDb["partidas"] = [];
  for (const p of input.partidas ?? []) {
    if (!ctx.itemIds.includes(p.itemId)) continue;
    const n = parseNumber(p.monto);
    if (n === undefined || n === 0) continue;
    if (Number.isNaN(n) || n < 0) return { ok: false, error: "Un monto de envío por partida no es válido" };
    if (p.tipo !== "unidad" && p.tipo !== "total") return { ok: false, error: "Elige si el monto es por unidad o total de la partida" };
    partidas.push({ item_id: p.itemId, monto: n, tipo: p.tipo });
  }
  if (partidas.length === 0) return none;
  const moneda = resolveCurrency(input.moneda, ctx.currencies);
  if (!moneda) return { ok: false, error: MIXED_ERROR };
  const map: Record<string, { monto: number; tipo: "unidad" | "total" }> = {};
  for (const p of partidas) map[p.item_id] = { monto: p.monto, tipo: p.tipo };
  return { ok: true, plan: { modo: "por_partida", moneda, partidas: map }, db: { modo: "por_partida", monto: null, moneda, partidas } };
}

/** Plan a partir de lo guardado en la base (el modo legado "aparte" equivale a "por_pedido"). */
export function planFromStored(
  row: { envio_modo?: string | null; envio_monto?: number | string | null; envio_moneda?: string | null } | null | undefined,
  partidas: { item_id: string; monto: number | string; tipo: string }[] = [],
): ShippingPlan {
  if (!row) return NO_SHIPPING;
  const moneda = row.envio_moneda === "MXN" || row.envio_moneda === "USD" ? row.envio_moneda : null;
  const modo = row.envio_modo === "aparte" ? "por_pedido" : row.envio_modo;
  if (!moneda) return NO_SHIPPING;
  if ((modo === "por_unidad" || modo === "por_pedido") && Number(row.envio_monto) > 0) {
    return { modo, monto: Number(row.envio_monto), moneda };
  }
  if (modo === "por_partida") {
    const map: Record<string, { monto: number; tipo: "unidad" | "total" }> = {};
    for (const p of partidas) if (Number(p.monto) > 0 && (p.tipo === "unidad" || p.tipo === "total")) map[p.item_id] = { monto: Number(p.monto), tipo: p.tipo };
    return Object.keys(map).length ? { modo: "por_partida", moneda, partidas: map } : NO_SHIPPING;
  }
  return NO_SHIPPING;
}

/**
 * Leyenda del pie sobre el envio. La plantilla se edita en Configuracion y usa {destino} y {via}.
 * Sin destino capturado no hay leyenda; sin via se omite ", via {via}".
 */
export const DEFAULT_SHIPPING_LEGEND = "Prices include shipping charges to your plant in {destino}, via {via}";

export function renderShippingLegend(template: string | null | undefined, destino: string | null | undefined, via: string | null | undefined): string | null {
  const d = destino?.trim();
  if (!d) return null;
  const v = via?.trim();
  let t = (template && template.trim()) || DEFAULT_SHIPPING_LEGEND;
  t = v ? t.replaceAll("{via}", v) : t.replace(/[,;]?\s*(via|vía|por)?\s*\{via\}/gi, "").replaceAll("{via}", "");
  return t.replaceAll("{destino}", d).replace(/\s+/g, " ").trim();
}

/** Valores iniciales del panel del vendedor a partir de lo guardado (el modo legado "aparte" es "por_pedido"). */
export function shippingDefaults(
  row: { envio_modo?: string | null; envio_monto?: number | string | null; envio_moneda?: string | null } | null | undefined,
  partidas: { item_id: string; monto: number | string; tipo: string }[],
  currencies: Currency[],
): {
  envioModo: ShippingMode;
  monto: string;
  moneda: Currency | "";
  partidas: Record<string, { monto: string; tipo: "unidad" | "total" }>;
} {
  const modo = row?.envio_modo === "aparte" ? "por_pedido" : row?.envio_modo;
  const envioModo: ShippingMode = modo === "por_unidad" || modo === "por_pedido" || modo === "por_partida" ? modo : "incluido";
  const stored = row?.envio_moneda === "MXN" || row?.envio_moneda === "USD" ? row.envio_moneda : null;
  return {
    envioModo,
    monto: row?.envio_monto ? String(Number(row.envio_monto)) : "",
    // Moneda guardada; si no hay, la de las partidas cuando es una sola; si mezcla, el vendedor la elige.
    moneda: stored ?? (currencies.length === 1 ? currencies[0] : ""),
    partidas: Object.fromEntries(
      partidas.map((p) => [p.item_id, { monto: String(Number(p.monto)), tipo: p.tipo === "unidad" ? ("unidad" as const) : ("total" as const) }]),
    ),
  };
}
