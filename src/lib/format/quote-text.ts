import { minCondition } from "@/lib/quotes/min-purchase";
import type { PriceTableItem } from "./price-table";

export interface QuoteForText {
  moneda: "MXN" | "USD";
  price_1: string | number;
  price_2: string | number;
  price_3: string | number;
  price_4: string | number;
  price_5: string | number;
  entrega_dias: number | null;
  entrega_tipo: "habiles" | "naturales" | null;
  entrega_fecha: string | null;
  compra_min_cantidad: string | number | null;
  compra_min_unidad: string | null;
  compra_min_monto: string | number | null;
}

export interface ItemForText {
  folio: string;
  /** Nombre para el cliente (el mismo que el PDF). */
  producto: string;
  cantidad: string | number | null;
  unidad: string | null;
  talla: string | null;
}

const n = (v: string | number) => Number(v).toFixed(2);

export function formatDelivery(q: Pick<QuoteForText, "entrega_dias" | "entrega_tipo" | "entrega_fecha">): string {
  if (q.entrega_dias !== null && q.entrega_tipo) {
    const dias = q.entrega_dias === 1 ? "1 dia" : `${q.entrega_dias} dias`;
    return `${dias} ${q.entrega_tipo === "habiles" ? "habiles" : "naturales"}`;
  }
  if (q.entrega_fecha) {
    const [y, m, d] = q.entrega_fecha.split("-");
    return `Fecha estimada ${d}/${m}/${y}`;
  }
  return "Por confirmar";
}

/**
 * Condicion de compra minima que ve el cliente: solo cuando es mayor a 1 (o hay monto minimo adicional).
 * Con minimo 1 devuelve null (se puede comprar desde 1 pieza).
 */
export function formatMinPurchase(
  q: Pick<QuoteForText, "compra_min_cantidad" | "compra_min_unidad" | "compra_min_monto" | "moneda">,
  unidadPartida?: string | null,
): string | null {
  return minCondition(q, unidadPartida);
}

/**
 * Convierte una partida y su cotizacion visible al vendedor en la entrada de
 * formatPriceTable. Solo toma campos publicos: nunca costo, envio, base ni proveedor.
 */
export function toPriceTableItem(
  item: ItemForText,
  quote: QuoteForText,
  precioElegido?: 1 | 2 | 3 | 4 | 5 | null,
): PriceTableItem {
  return {
    folio: item.folio,
    producto: item.producto,
    cantidad: item.cantidad === null ? null : Number(item.cantidad),
    unidad: item.unidad,
    talla: item.talla,
    moneda: quote.moneda,
    entrega: formatDelivery(quote),
    compraMinima: formatMinPurchase(quote, item.unidad),
    precios: [n(quote.price_1), n(quote.price_2), n(quote.price_3), n(quote.price_4), n(quote.price_5)],
    precioElegido: precioElegido ?? null,
  };
}
