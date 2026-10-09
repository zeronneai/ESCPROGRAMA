export type ItemStatus = "pendiente" | "cotizada" | "no_encontrada" | "enviada_cliente";
export type RequestStatus = "borrador" | "enviada";

export interface ReferenceRow {
  id: string;
  tipo: "imagen" | "link";
  url: string;
  /** URL firmada (solo imagenes), generada en el servidor. */
  signedUrl?: string | null;
}

/** Cotizacion visible al vendedor (sin costos). */
export interface QuoteRow {
  item_id: string;
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
  nota: string | null;
  quoted_at: string;
}

export interface DispatchRow {
  item_id: string;
  quote_version: number;
  precio_elegido: number;
  valor: number | string;
  enviado_at: string;
}

export interface ItemRow {
  id: string;
  request_id: string;
  folio: string | null;
  posicion: number;
  producto: string;
  descripcion: string;
  cantidad: number | string | null;
  unidad: string | null;
  talla: string | null;
  notas: string | null;
  estado: ItemStatus;
  not_found_note: string | null;
  first_response_at: string | null;
  item_references: ReferenceRow[];
  item_quotes: QuoteRow[];
  item_dispatch: DispatchRow[];
}

/** La cotizacion vigente es la version mas reciente. */
export function latestQuote(item: Pick<ItemRow, "item_quotes">): QuoteRow | null {
  if (!item.item_quotes?.length) return null;
  return [...item.item_quotes].sort((a, b) => b.version - a.version)[0];
}

export function latestDispatch(item: Pick<ItemRow, "item_dispatch">): DispatchRow | null {
  if (!item.item_dispatch?.length) return null;
  return [...item.item_dispatch].sort((a, b) => b.quote_version - a.quote_version)[0];
}

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  pendiente: "Pendiente",
  cotizada: "Cotizada",
  no_encontrada: "No encontrada",
  enviada_cliente: "Enviada al cliente",
};
