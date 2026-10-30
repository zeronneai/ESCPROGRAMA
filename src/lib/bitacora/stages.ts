import { DateTime } from "luxon";

/**
 * Bitacora de ventas y prospeccion (formato ESC-VEN-FR-002). Un registro por cliente/oportunidad.
 * Las etapas siguen las columnas del formato, en orden.
 */
export interface BitacoraRow {
  id: string;
  vendedor_id: string | null;
  customer_id: string;
  request_id: string | null;
  necesidad: string | null;
  fecha_catalogo: string | null;
  fecha_muestra: string | null;
  muestra_no_aplica: boolean;
  fecha_solicitud_compras: string | null;
  fecha_cotizacion: string | null;
  fecha_pedido: string | null;
  facturacion: "contado" | "credito" | null;
  fecha_factura: string | null;
  monto_venta: number | string | null;
  moneda: "MXN" | "USD";
  porcentaje_cobranza: number | string | null;
  fecha_entrega: string | null;
  cartera_dias_vencidos: number | null;
  cartera_monto: number | string | null;
  comentarios: string | null;
  proximo_seguimiento: string | null;
  resultado: "abierta" | "ganada" | "perdida";
  motivo_perdida: string | null;
  origen: "vendedor" | "portal" | "sitio_web" | "lead";
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type StageKey = "catalogo" | "necesidad" | "muestra" | "solicitud" | "cotizacion" | "pedido" | "factura" | "entrega" | "cobranza";

export interface StageDef {
  key: StageKey;
  label: string;
  short: string;
  /** Columna de fecha del formato (null = se marca de otra forma). */
  field: keyof BitacoraRow | null;
  hint: string;
}

export const STAGES: StageDef[] = [
  { key: "catalogo", label: "Presentación y entrega de catálogo", short: "Catálogo", field: "fecha_catalogo", hint: "Primera visita o llamada con catálogo" },
  { key: "necesidad", label: "Necesidad del cliente", short: "Necesidad", field: null, hint: "Qué producto necesita y para qué" },
  { key: "muestra", label: "Preparación de muestra (cuando aplique)", short: "Muestra", field: "fecha_muestra", hint: "Si pidió muestra" },
  { key: "solicitud", label: "Solicitud de cotización a compras", short: "Solicitud a compras", field: "fecha_solicitud_compras", hint: "Se llena sola al enviar la solicitud en el portal" },
  { key: "cotizacion", label: "Cotización enviada al cliente", short: "Cotización", field: "fecha_cotizacion", hint: "Se llena sola al registrar el envío en el portal" },
  { key: "pedido", label: "Orden de compra o confirmación de pedido", short: "Pedido", field: "fecha_pedido", hint: "Se llena sola al marcar una partida Ganada" },
  { key: "factura", label: "Facturación", short: "Facturado", field: "fecha_factura", hint: "Contado o crédito" },
  { key: "entrega", label: "Entrega del producto", short: "Entregado", field: "fecha_entrega", hint: "Fecha en que se entregó" },
  { key: "cobranza", label: "Cobranza", short: "Cobrado", field: null, hint: "Porcentaje cobrado" },
];

export function stageDone(row: BitacoraRow, key: StageKey): boolean {
  switch (key) {
    case "necesidad":
      return !!row.necesidad?.trim();
    case "muestra":
      return !!row.fecha_muestra;
    case "cobranza":
      return Number(row.porcentaje_cobranza ?? 0) >= 100;
    default: {
      const f = STAGES.find((s) => s.key === key)!.field!;
      return !!row[f];
    }
  }
}

/** Etapa actual: la mas avanzada alcanzada (la muestra no cuenta como pendiente si no aplica). */
export function currentStage(row: BitacoraRow): { index: number; stage: StageDef | null } {
  let idx = -1;
  STAGES.forEach((s, i) => {
    if (stageDone(row, s.key)) idx = i;
  });
  return { index: idx, stage: idx >= 0 ? STAGES[idx] : null };
}

export function stageState(row: BitacoraRow, i: number): "done" | "na" | "pending" | "future" {
  const s = STAGES[i];
  if (stageDone(row, s.key)) return "done";
  if (s.key === "muestra" && row.muestra_no_aplica) return "na";
  return i < currentStage(row).index ? "pending" : "future";
}

/** Grupos para el resumen (y filtros) de cada seccion. */
export type ProspectGroup = "contacto" | "necesidad" | "cotizando" | "pedido";
export type SalesGroup = "cotizando" | "pedido" | "facturado" | "entregado" | "cobrado";

export function prospectGroup(row: BitacoraRow): ProspectGroup {
  const i = currentStage(row).index;
  if (i >= 5) return "pedido";
  if (i >= 3) return "cotizando";
  if (i >= 1) return "necesidad";
  return "contacto";
}
export const PROSPECT_GROUPS: { id: ProspectGroup; label: string; color: string }[] = [
  { id: "contacto", label: "Primer contacto", color: "bg-slate-400" },
  { id: "necesidad", label: "Necesidad / muestra", color: "bg-sky-500" },
  { id: "cotizando", label: "Cotizando", color: "bg-amber-500" },
  { id: "pedido", label: "Ya hizo pedido", color: "bg-green-600" },
];

export function salesGroup(row: BitacoraRow): SalesGroup {
  if (stageDone(row, "cobranza")) return "cobrado";
  if (row.fecha_entrega) return "entregado";
  if (row.fecha_factura || row.facturacion) return "facturado";
  if (row.fecha_pedido) return "pedido";
  return "cotizando";
}
export const SALES_GROUPS: { id: SalesGroup; label: string; color: string }[] = [
  { id: "cotizando", label: "En cotización", color: "bg-amber-500" },
  { id: "pedido", label: "Pedido", color: "bg-indigo-500" },
  { id: "facturado", label: "Facturado", color: "bg-sky-500" },
  { id: "entregado", label: "Entregado", color: "bg-teal-500" },
  { id: "cobrado", label: "Cobrado", color: "bg-green-600" },
];

export const RESULT_LABEL: Record<BitacoraRow["resultado"], string> = { abierta: "En proceso", ganada: "Venta cerrada", perdida: "Perdida" };

export const EVENT_LABEL: Record<string, string> = {
  fecha_catalogo: "Presentación y catálogo",
  fecha_muestra: "Muestra",
  fecha_solicitud_compras: "Solicitud a compras",
  fecha_cotizacion: "Cotización enviada",
  fecha_pedido: "Orden de compra / pedido",
  fecha_factura: "Facturación",
  fecha_entrega: "Entrega",
  cobranza: "Cobranza",
};

export function eventText(e: { tipo: string; etapa: string | null; nota: string | null }): string {
  if (e.tipo === "alta") return e.nota === "portal" ? "Registro creado al enviar la solicitud en el portal" : e.nota === "sitio_web" ? "Registro creado desde el sitio web" : e.nota === "lead" ? "Registro copiado de Leads" : "Registro creado";
  if (e.tipo === "etapa") {
    const label = EVENT_LABEL[e.etapa ?? ""] ?? e.etapa;
    if (e.etapa === "cobranza") return `${label}: ${e.nota}`;
    return `${label}: ${e.nota ? DateTime.fromISO(e.nota).setLocale("es-MX").toFormat("d LLL yyyy") : ""}`;
  }
  if (e.tipo === "resultado") return `Resultado: ${e.nota}`;
  return e.nota ?? "";
}

export const isoDate = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
