import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { formatMinPurchase } from "@/lib/format/quote-text";
import { minAlert, pdfQuantity, type MinDecision } from "@/lib/quotes/min-purchase";
import { isVigenciaVencida, requestRevision, revisionFolio } from "@/lib/quotes/revisions";
import { allocateShipping, NO_SHIPPING, totalsByCurrency, type AllocResult, type ShippingPlan } from "@/lib/pricing/shipping-allocation";
import { renderShippingLegend } from "./shipping";
import type { QuoteRow } from "@/lib/quotes/types";

/**
 * Modelo de datos del PDF de cotizacion para el cliente.
 *
 * PRIVACIDAD: este modulo solo recibe y devuelve lo que el cliente puede ver. Aunque la entrada
 * traiga campos de mas (costos, los otros precios, proveedor), SOLO se leen los campos listados
 * aqui; nunca se copian al modelo.
 */

export interface PdfCompany {
  nombre_comercial: string;
  razon_social: string;
  telefono: string;
  web: string;
  direccion: string;
  rfc: string;
  pie_lineas: string[];
  /** Plantilla de la leyenda de envio del pie (usa {destino} y {via}); editable en Configuracion. */
  leyenda_envio?: string | null;
}

export interface PdfItemInput {
  /** Id de la partida (para el envio por partida). */
  id: string;
  folio: string;
  /** Nombre para el cliente (el editado por el vendedor). La descripcion y el uso del producto son internos: no entran al PDF. */
  nombre: string;
  cantidad: number | string | null;
  unidad: string | null;
  talla: string | null;
  /** Version vigente de la cotizacion. */
  quote: {
    version: number;
    moneda: "MXN" | "USD";
    price_1: number | string;
    price_2: number | string;
    price_3: number | string;
    price_4: number | string;
    price_5: number | string;
    entrega_dias: number | null;
    entrega_tipo: "habiles" | "naturales" | null;
    entrega_fecha: string | null;
    compra_min_cantidad: number | string | null;
    compra_min_unidad: string | null;
    compra_min_monto: number | string | null;
    valid_until: string | null;
  };
  /** Precio elegido por el vendedor (1 a 5) para esa version, o null si aun no elige. */
  precioElegido: number | null;
  /** Si la cantidad pedida es menor al minimo, lo que eligio el vendedor para esta revision. */
  decisionMin?: MinDecision | null;
}

/** Adapta la cotizacion visible al vendedor al formato del PDF (solo campos publicos). */
export function toPdfQuote(q: QuoteRow): PdfItemInput["quote"] {
  return {
    version: q.version, moneda: q.moneda,
    price_1: q.price_1, price_2: q.price_2, price_3: q.price_3, price_4: q.price_4, price_5: q.price_5,
    entrega_dias: q.entrega_dias, entrega_tipo: q.entrega_tipo, entrega_fecha: q.entrega_fecha,
    compra_min_cantidad: q.compra_min_cantidad, compra_min_unidad: q.compra_min_unidad, compra_min_monto: q.compra_min_monto,
    valid_until: q.valid_until,
  };
}

export interface PdfInput {
  company: PdfCompany;
  folio: string;
  customerName: string;
  vendedorNombre: string;
  items: PdfItemInput[];
  data: {
    condiciones: string;
    atencion: string | null;
    destino_entrega: string | null;
    via_envio: string | null;
    /** Envio al cliente DENTRO del precio unitario (nunca se muestra como renglon ni desglose). */
    envio: ShippingPlan;
  };
  now: Date;
  timezone: string;
}

export type PdfCurrency = "PESOS" | "DOLARES";

export interface PdfRow {
  te: string;
  nombre: string;
  cant: string;
  currency: PdfCurrency;
  uPrice: string;
  price: string;
}

export interface PdfModel {
  company: Pick<PdfCompany, "nombre_comercial" | "razon_social" | "telefono" | "web" | "direccion" | "rfc">;
  fecha: string;
  folio: string;
  condiciones: string;
  asesor: string;
  vigencia: string;
  empresa: string;
  atencion: string | null;
  rows: PdfRow[];
  totals: { currency: PdfCurrency; amount: string }[];
  /** Una linea por partida con compra minima mayor a 1 (franja amarilla). Vacio = sin franja. */
  minimumPurchases: string[];
  footer: string[];
}

export const COLUMN_HEADERS = ["TE", "Product Name", "CANT", "Currency", "U. Price", "Price"] as const;

const CURRENCY: Record<"MXN" | "USD", PdfCurrency> = { MXN: "PESOS", USD: "DOLARES" };
const dmy = (d: DateTime) => d.toFormat("dd/MM/yyyy");

export function formatMoney(v: Decimal.Value): string {
  const [int, dec] = new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2).split(".");
  return `$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
}

export function pdfDelivery(q: PdfItemInput["quote"]): string {
  if (q.entrega_dias !== null && q.entrega_tipo) {
    return `${q.entrega_dias}-${q.entrega_tipo === "habiles" ? "Business days" : "Days"}`;
  }
  if (q.entrega_fecha) {
    const [y, m, d] = q.entrega_fecha.split("-");
    return `${d}/${m}/${y}`;
  }
  return "TBD";
}

const pick = (q: PdfItemInput["quote"], n: number | null): Decimal | null => {
  if (!n || n < 1 || n > 5) return null;
  return new Decimal([q.price_1, q.price_2, q.price_3, q.price_4, q.price_5][n - 1]);
};

/** Que falta para poder generar el PDF (lo usa la interfaz y el servidor). */
export function pdfProblems(
  items: Array<
    Pick<PdfItemInput, "folio" | "precioElegido"> & {
      quote: (Partial<PdfItemInput["quote"]> & { valid_until: string | null }) | null;
      estado?: string;
      cantidad?: number | string | null;
      unidad?: string | null;
      decisionMin?: MinDecision | null;
    }
  >,
  now: Date,
): string[] {
  const out: string[] = [];
  const quoted = items.filter((i) => i.quote);
  if (quoted.length === 0) out.push("Aun no hay partidas cotizadas");
  for (const i of quoted) {
    if (isVigenciaVencida(i.quote, now)) out.push("Vigencia vencida: solicita actualización");
    else if (!i.precioElegido) out.push(`Elige el precio de la partida ${i.folio}`);
    const alerta = i.quote && i.cantidad !== undefined ? minAlert({ cantidad: i.cantidad, unidad: i.unidad ?? null }, { compra_min_cantidad: null, compra_min_unidad: null, compra_min_monto: null, ...i.quote }) : null;
    if (alerta && !i.decisionMin) {
      out.push(`Partida ${i.folio}: ${alerta.text}. Elige "Cotizar a la cantidad mínima" o "Mantener la cantidad pedida"`);
    }
  }
  return [...new Set(out)];
}

type Cur = "MXN" | "USD";

/** Monedas distintas que usan las partidas (en orden MXN, USD). */
export function itemCurrencies(items: Array<{ quote: { moneda: Cur } | null }>): Cur[] {
  const set = new Set(items.filter((i) => i.quote).map((i) => i.quote!.moneda));
  return (["MXN", "USD"] as const).filter((c) => set.has(c));
}

export interface OrderLinePreview {
  incremento: string;
  precioUnitario: string;
  importe: string;
  envio: string;
}

export interface OrderPreview {
  /** Por id de partida (solo las que ya tienen precio elegido). */
  lines: Record<string, OrderLinePreview>;
  /** Total por moneda (suma de los importes). Nunca mezcla pesos y dolares. */
  perCurrency: { currency: PdfCurrency; total: string; envio: string }[];
  /** Envio repartido en los precios (sumado de todas las monedas), o null si no hay. */
  envioIncluido: string | null;
  /** Monedas con envio repartido (para el texto neutral "Envio incluido en precios"). */
  envioPorMoneda: { currency: PdfCurrency; amount: string }[];
}

const toLine = (r: AllocResult): OrderLinePreview => ({
  incremento: formatMoney(r.incremento),
  precioUnitario: formatMoney(r.precioUnitario),
  importe: formatMoney(r.importe),
  envio: formatMoney(r.envio),
});

/**
 * Importes por partida y total por moneda con el envio ya incluido en el precio unitario.
 * Solo usa el precio ELEGIDO (nunca los otros 4 precios) y solo cuenta partidas con precio elegido.
 * Lo usan el PDF y la vista previa del panel, para que coincidan siempre.
 */
export function computeOrder(
  items: Array<{
    id: string;
    cantidad: number | string | null;
    unidad?: string | null;
    precioElegido: number | null;
    quote: PdfItemInput["quote"] | null;
    decisionMin?: MinDecision | null;
  }>,
  plan: ShippingPlan = NO_SHIPPING,
): OrderPreview {
  const alloc = items.flatMap((i) => {
    if (!i.quote) return [];
    const unit = pick(i.quote, i.precioElegido);
    return unit ? [{ id: i.id, moneda: i.quote.moneda, cantidad: pdfQuantity({ cantidad: i.cantidad, unidad: i.unidad ?? null }, i.quote, i.decisionMin), precioElegido: unit }] : [];
  });
  const r = allocateShipping(alloc, plan);
  const totals = totalsByCurrency(r.lines);
  const envioPorMoneda = totals.filter((t) => t.envio.greaterThan(0)).map((t) => ({ currency: CURRENCY[t.moneda], amount: formatMoney(t.envio) }));
  return {
    lines: Object.fromEntries(r.lines.map((l) => [l.id, toLine(l)])),
    perCurrency: totals.map((t) => ({ currency: CURRENCY[t.moneda], total: formatMoney(t.total), envio: formatMoney(t.envio) })),
    envioIncluido: r.repartido.greaterThan(0) ? formatMoney(r.repartido) : null,
    envioPorMoneda,
  };
}

export function buildPdfModel(input: PdfInput): PdfModel {
  const tz = input.timezone;
  const items = input.items.filter((i) => i.quote);
  const problems = pdfProblems(items, input.now);
  if (problems.length) throw new PdfNotReadyError(problems);

  const order = computeOrder(items, input.data.envio);
  const rows: PdfRow[] = items.map((i) => {
    const l = order.lines[i.id];
    // Si el vendedor eligio cotizar a la cantidad minima, CANT muestra el minimo y el total va sobre el minimo.
    const cantidad = pdfQuantity(i, i.quote, i.decisionMin);
    const qty = cantidad !== null && cantidad !== "" && Number(cantidad) > 0 ? new Decimal(cantidad) : null;
    const cant = [qty ? `${qty.toString()}${i.unidad ? ` ${i.unidad}` : ""}` : "", i.talla ? `Talla ${i.talla}` : ""].filter(Boolean).join(" / ");
    return {
      te: pdfDelivery(i.quote),
      nombre: i.nombre,
      cant: cant || "1",
      currency: CURRENCY[i.quote.moneda],
      // El envio ya va dentro del precio unitario: el PDF solo muestra el costo final.
      uPrice: l.precioUnitario,
      price: l.importe,
    };
  });
  const d = input.data;
  const destino = d.destino_entrega?.trim() || null;
  const via = d.via_envio?.trim() || null;

  // Franja amarilla: una linea por partida con minimo mayor a 1, indicando de que producto es.
  const minimumPurchases = items.flatMap((i, n) => {
    const v = formatMinPurchase(i.quote, i.unidad);
    return v ? [`Minimum purchase: ${v} (${i.nombre.trim() || `renglón ${n + 1}`})`] : [];
  });

  const footer = [...input.company.pie_lineas];
  // Leyenda de envio (editable en Configuracion): siempre que haya destino capturado.
  const legend = renderShippingLegend(input.company.leyenda_envio, destino, via);
  if (legend) footer.push(legend);

  const valids = items.map((i) => i.quote.valid_until).filter((v): v is string => !!v).sort();
  const rev = requestRevision(items.map((i) => ({ item_quotes: [{ version: i.quote.version }] })));

  return {
    company: {
      nombre_comercial: input.company.nombre_comercial,
      razon_social: input.company.razon_social,
      telefono: input.company.telefono,
      web: input.company.web,
      direccion: input.company.direccion,
      rfc: input.company.rfc,
    },
    fecha: dmy(DateTime.fromJSDate(input.now, { zone: tz })),
    folio: revisionFolio(input.folio, rev),
    condiciones: d.condiciones || "Credito",
    asesor: input.vendedorNombre,
    vigencia: valids[0] ? dmy(DateTime.fromISO(valids[0], { zone: tz })) : "",
    empresa: input.customerName,
    atencion: d.atencion?.trim() || null,
    rows,
    totals: order.perCurrency.map((t) => ({ currency: t.currency, amount: t.total })),
    minimumPurchases,
    footer,
  };
}

export class PdfNotReadyError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join("; "));
    this.name = "PdfNotReadyError";
  }
}

/** Nombre del archivo: COT-2026-0001_<cliente>.pdf (sin caracteres problematicos). */
export function pdfFileName(requestFolio: string, customerName: string): string {
  const cliente = customerName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `${requestFolio}_${cliente || "cliente"}.pdf`;
}
