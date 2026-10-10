export type ItemStatus =
  | "pendiente"
  | "cotizada"
  | "no_encontrada"
  | "enviada_cliente"
  | "actualizacion_solicitada"
  | "esperando_aclaracion";
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
  valid_until: string | null;
}

export interface DispatchRow {
  item_id: string;
  quote_version: number;
  precio_elegido: number;
  valor: number | string;
  enviado_at: string;
}

export interface UpdateRequestRow {
  id: string;
  item_id: string;
  quote_version: number;
  requested_at: string;
  nota: string | null;
  due_at: string;
  resolved_at: string | null;
  resolved_version: number | null;
  resolution: "sin_cambios" | "actualizado" | null;
  response_business_hours: number | string | null;
}

export interface PauseRow {
  id: string;
  item_id: string;
  clarification_requested_at: string;
  resumed_at: string | null;
  estado_previo: ItemStatus;
}

export interface MessageRow {
  id: string;
  item_id: string;
  author_rol: "vendedor" | "comprador";
  kind: "mensaje" | "pedir_aclaracion" | "respuesta";
  body: string | null;
  image_path: string | null;
  created_at: string;
  /** URL firmada de la imagen (se agrega en el servidor). */
  imageUrl?: string | null;
}

export type OutcomeResult = "sin_respuesta" | "ganada" | "perdida";
export type LossReason = "precio_alto" | "tiempo_entrega" | "compra_minima" | "otro_proveedor" | "proyecto_cancelado" | "otro";

export interface OutcomeRow {
  item_id: string;
  quote_version: number;
  resultado: OutcomeResult;
  motivo: LossReason | null;
  motivo_texto: string | null;
  cantidad_final: number | string | null;
  updated_at: string;
}

export interface PriceChoiceRow {
  item_id: string;
  quote_version: number;
  precio: number;
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
  item_update_requests?: UpdateRequestRow[];
  item_clarification_pauses?: PauseRow[];
  item_messages?: MessageRow[];
  item_outcomes?: OutcomeRow[];
  item_price_choice?: PriceChoiceRow[];
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
  actualizacion_solicitada: "Actualización solicitada",
  esperando_aclaracion: "Esperando aclaración",
};

export const LOSS_REASON_LABEL: Record<LossReason, string> = {
  precio_alto: "Precio alto",
  tiempo_entrega: "Tiempo de entrega",
  compra_minima: "Compra mínima",
  otro_proveedor: "Compró con otro proveedor",
  proyecto_cancelado: "Cancelaron el proyecto",
  otro: "Otro",
};

export function latestOutcome(item: Pick<ItemRow, "item_outcomes">): OutcomeRow | null {
  if (!item.item_outcomes?.length) return null;
  return [...item.item_outcomes].sort((a, b) => b.quote_version - a.quote_version)[0];
}

export function openUpdateRequest(item: Pick<ItemRow, "item_update_requests">): UpdateRequestRow | null {
  return item.item_update_requests?.find((u) => !u.resolved_at) ?? null;
}

export function openPause(item: Pick<ItemRow, "item_clarification_pauses">): PauseRow | null {
  return item.item_clarification_pauses?.find((p) => !p.resumed_at) ?? null;
}
