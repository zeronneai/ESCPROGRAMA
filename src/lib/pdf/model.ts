import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { formatMinPurchase } from "@/lib/format/quote-text";
import { isVigenciaVencida, requestRevision, revisionFolio } from "@/lib/quotes/revisions";

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
}

export interface PdfItemInput {
  folio: string;
  producto: string;
  descripcion: string;
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
    envio_modo: "incluido" | "aparte";
    envio_monto: number | string | null;
    envio_moneda: "MXN" | "USD" | null;
  };
  now: Date;
  timezone: string;
}

export type PdfCurrency = "PESOS" | "DOLARES";

export interface PdfRow {
  te: string;
  nombre: string;
  descripcion: string;
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
  minimumPurchase: string | null;
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
export function pdfProblems(items: Array<Pick<PdfItemInput, "folio" | "precioElegido"> & { quote: { valid_until: string | null } | null; estado?: string }>, now: Date): string[] {
  const out: string[] = [];
  const quoted = items.filter((i) => i.quote);
  if (quoted.length === 0) out.push("Aun no hay partidas cotizadas");
  for (const i of quoted) {
    if (isVigenciaVencida(i.quote, now)) out.push("Vigencia vencida: solicita actualización");
    else if (!i.precioElegido) out.push(`Elige el precio de la partida ${i.folio}`);
  }
  return [...new Set(out)];
}

export function buildPdfModel(input: PdfInput): PdfModel {
  const tz = input.timezone;
  const items = input.items.filter((i) => i.quote);
  const problems = pdfProblems(items, input.now);
  if (problems.length) throw new PdfNotReadyError(problems);

  const rows: PdfRow[] = [];
  const totals = new Map<PdfCurrency, Decimal>();
  const add = (c: PdfCurrency, v: Decimal) => totals.set(c, (totals.get(c) ?? new Decimal(0)).plus(v));

  for (const i of items) {
    const unit = pick(i.quote, i.precioElegido)!;
    const qty = i.cantidad !== null && i.cantidad !== "" && Number(i.cantidad) > 0 ? new Decimal(i.cantidad) : null;
    const line = unit.times(qty ?? 1);
    const currency = CURRENCY[i.quote.moneda];
    add(currency, line.toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
    const cant = [qty ? `${qty.toString()}${i.unidad ? ` ${i.unidad}` : ""}` : "", i.talla ? `Talla ${i.talla}` : ""].filter(Boolean).join(" / ");
    rows.push({
      te: pdfDelivery(i.quote),
      nombre: i.producto,
      descripcion: i.descripcion,
      cant: cant || "1",
      currency,
      uPrice: formatMoney(unit),
      price: formatMoney(line),
    });
  }

  const d = input.data;
  const destino = d.destino_entrega?.trim() || null;
  const via = d.via_envio?.trim() || null;
  if (d.envio_modo === "aparte" && d.envio_monto && d.envio_moneda && Number(d.envio_monto) > 0) {
    const monto = new Decimal(d.envio_monto);
    const currency = CURRENCY[d.envio_moneda];
    add(currency, monto);
    rows.push({
      te: "",
      nombre: `Shipping${destino ? ` to ${destino}` : ""}${via ? ` via ${via}` : ""}`,
      descripcion: "",
      cant: "1",
      currency,
      uPrice: formatMoney(monto),
      price: formatMoney(monto),
    });
  }

  const mins = items
    .map((i) => ({ producto: i.producto, value: formatMinPurchase({ ...i.quote, moneda: i.quote.moneda }) }))
    .filter((m): m is { producto: string; value: string } => !!m.value);
  const distinct = [...new Set(mins.map((m) => m.value))];
  const minimumPurchase = mins.length === 0 ? null : distinct.length === 1 ? distinct[0] : mins.map((m) => `${m.producto}: ${m.value}`).join("; ");

  const footer = [...input.company.pie_lineas];
  if (d.envio_modo === "incluido" && destino) {
    footer.push(`Prices include shipping charges to your plant in ${destino}${via ? `, via ${via}` : ""}`);
  }

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
    totals: (["PESOS", "DOLARES"] as const)
      .filter((c) => totals.has(c))
      .map((c) => ({ currency: c, amount: formatMoney(totals.get(c)!) })),
    minimumPurchase,
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
