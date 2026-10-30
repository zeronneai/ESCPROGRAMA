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

// ---------------------------------------------------------------------------
// Como ve el cliente el envio (presentacion)
// ---------------------------------------------------------------------------

/**
 * - sin_envio: cliente local o recoge; no hay cargo.
 * - incluido:  "envio gratis": el monto se reparte dentro de los precios (por pedido, por unidad o por partida).
 * - aparte:    un renglon "Envio" en el PDF, sumado al total.
 * - mixto:     una parte incluida en los precios y otra como renglon aparte.
 */
export type ShippingPresentation = "sin_envio" | "incluido" | "aparte" | "mixto";

export const PRESENTATION_LABEL: Record<ShippingPresentation, string> = {
  sin_envio: "Sin envío",
  incluido: "Incluido en el precio",
  aparte: "Cargo aparte",
  mixto: "Mixto",
};
export const PRESENTATION_HINT: Record<ShippingPresentation, string> = {
  sin_envio: "Cliente local o recoge en sucursal. El PDF no menciona envío.",
  incluido: "\"Envío gratis\": el envío se reparte dentro del precio unitario.",
  aparte: "El PDF muestra un renglón \"Envío\" con su monto, sumado al total.",
  mixto: "Una parte se reparte en los precios y otra sale como renglón \"Envío\".",
};

/** Los modos que reparten envio dentro del precio (para "incluido" y la parte incluida de "mixto"). */
export type DistributionMode = Exclude<ShippingMode, "incluido">;
export const DISTRIBUTION_LABEL: Record<DistributionMode, string> = {
  por_pedido: "Repartido en todo el pedido",
  por_unidad: "Mismo monto por unidad",
  por_partida: "Monto por partida",
};

export interface ShippingAparte {
  monto: number;
  moneda: Currency;
}

export interface ShippingSetupInput extends ShippingInput {
  presentacion: ShippingPresentation;
  aparteMonto?: string | null;
}

export type ShippingSetupParse =
  | {
      ok: true;
      presentacion: ShippingPresentation;
      plan: ShippingPlan;
      aparte: ShippingAparte | null;
      db: ShippingDb & { presentacion: ShippingPresentation; aparte_monto: number | null; aparte_moneda: Currency | null };
    }
  | { ok: false; error: string };

/** Valida la captura completa del envio: la parte incluida (plan) y la parte aparte. */
export function parseShippingSetup(input: ShippingSetupInput, ctx: { currencies: Currency[]; itemIds: string[] }): ShippingSetupParse {
  const p = input.presentacion;
  const wantsIncluded = p === "incluido" || p === "mixto";
  const wantsAparte = p === "aparte" || p === "mixto";

  let included: Extract<ShippingParse, { ok: true }> = { ok: true, plan: NO_SHIPPING, db: { modo: "incluido", monto: null, moneda: null, partidas: [] } };
  if (wantsIncluded) {
    const modo: ShippingMode = input.modo === "incluido" ? "por_pedido" : input.modo;
    const r = parseShippingPlan({ ...input, modo }, ctx);
    if (!r.ok) return r;
    if (r.plan.modo === "incluido") return { ok: false, error: "Captura el monto del envío incluido en los precios" };
    included = r;
  }

  let aparte: ShippingAparte | null = null;
  if (wantsAparte) {
    const n = parseNumber(input.aparteMonto ?? "");
    if (n === undefined || n === 0) return { ok: false, error: "Captura el monto del envío que va aparte" };
    if (Number.isNaN(n) || n < 0) return { ok: false, error: "El monto del envío aparte no es válido" };
    const moneda = resolveCurrency(input.moneda, ctx.currencies);
    if (!moneda) return { ok: false, error: MIXED_ERROR };
    aparte = { monto: Math.round(n * 100) / 100, moneda };
  }

  return {
    ok: true,
    presentacion: p,
    plan: included.plan,
    aparte,
    db: { ...included.db, presentacion: p, aparte_monto: aparte?.monto ?? null, aparte_moneda: aparte?.moneda ?? null },
  };
}

type StoredPdfRow = {
  envio_modo?: string | null;
  envio_monto?: number | string | null;
  envio_moneda?: string | null;
  envio_presentacion?: string | null;
  envio_aparte_monto?: number | string | null;
  envio_aparte_moneda?: string | null;
} | null | undefined;

/** Presentacion guardada; lo anterior a esta opcion se deduce del modo (con monto = incluido). */
export function storedPresentation(row: StoredPdfRow): ShippingPresentation | null {
  if (!row) return null;
  const p = row.envio_presentacion;
  if (p === "sin_envio" || p === "incluido" || p === "aparte" || p === "mixto") return p;
  return null;
}

export function aparteFromStored(row: StoredPdfRow): ShippingAparte | null {
  const p = storedPresentation(row);
  if (p !== "aparte" && p !== "mixto") return null;
  const m = row?.envio_aparte_moneda;
  const n = Number(row?.envio_aparte_monto);
  return (m === "MXN" || m === "USD") && n > 0 ? { monto: n, moneda: m } : null;
}

/** Valores iniciales de presentacion para el panel. */
export function presentationDefaults(row: StoredPdfRow): { presentacion: ShippingPresentation; aparteMonto: string } {
  const stored = storedPresentation(row);
  const legacyIncluded = row?.envio_modo && row.envio_modo !== "incluido";
  return {
    presentacion: stored ?? (legacyIncluded ? "incluido" : "sin_envio"),
    aparteMonto: row?.envio_aparte_monto ? String(Number(row.envio_aparte_monto)) : "",
  };
}
