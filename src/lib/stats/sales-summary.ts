import { DateTime } from "luxon";
import type { BitacoraRow } from "@/lib/bitacora/stages";

/** Resumen por vendedor para la jefa de ventas (cotizaciones + bitacora de ventas y prospeccion). */
export type Period = "7d" | "mes" | "mes_anterior" | "anio";
export const PERIODS: { id: Period; label: string }[] = [
  { id: "7d", label: "Últimos 7 días" },
  { id: "mes", label: "Este mes" },
  { id: "mes_anterior", label: "Mes anterior" },
  { id: "anio", label: "Este año" },
];

export function periodRange(p: Period, now: DateTime): { from: DateTime; to: DateTime } {
  switch (p) {
    case "7d":
      return { from: now.startOf("day").minus({ days: 6 }), to: now.endOf("day") };
    case "mes_anterior": {
      const m = now.minus({ months: 1 });
      return { from: m.startOf("month"), to: m.endOf("month") };
    }
    case "anio":
      return { from: now.startOf("year"), to: now.endOf("day") };
    default:
      return { from: now.startOf("month"), to: now.endOf("day") };
  }
}

export type SummaryBitacora = Pick<
  BitacoraRow,
  "vendedor_id" | "resultado" | "fecha_pedido" | "monto_venta" | "moneda" | "cartera_dias_vencidos" | "cartera_monto" | "proximo_seguimiento" | "created_at" | "updated_at" | "archived_at"
> & { customers: { tipo: "cliente" | "prospecto" } | null };

export interface SummaryInput {
  sellers: { id: string; nombre: string; activo: boolean }[];
  /** Solicitudes enviadas a compras en el periodo. */
  requests: { vendedor_id: string; submitted_at: string }[];
  /** Cotizaciones registradas como enviadas al cliente en el periodo. */
  issues: { emitida_por: string; request_id: string; emitida_at: string }[];
  bitacora: SummaryBitacora[];
  /** Prospectos convertidos a cliente en el periodo. */
  conversions: { convertido_por: string | null }[];
  /** Movimientos de bitacora en el periodo. */
  events: { created_by: string | null; created_at: string }[];
  /** Fechas (yyyy-mm-dd) del periodo y de hoy en la zona del negocio. */
  fromDate: string;
  toDate: string;
  today: string;
}

export interface SellerSummary {
  id: string;
  nombre: string;
  activo: boolean;
  solicitudes: number;
  cotizacionesEnviadas: number;
  pedidos: number;
  montoPedidos: number;
  conversion: number | null;
  ventasActivas: number;
  prospectosActivos: number;
  prospectosNuevos: number;
  convertidos: number;
  carteraVencida: number;
  seguimientosVencidos: number;
  movimientos: number;
  ultimaActividad: string | null;
}

export function summarizeSellers(i: SummaryInput): SellerSummary[] {
  const inDate = (d: string | null) => !!d && d >= i.fromDate && d <= i.toDate;
  const dayOf = (iso: string) => iso.slice(0, 10);
  return i.sellers
    .map((s) => {
      const b = i.bitacora.filter((r) => r.vendedor_id === s.id && !r.archived_at);
      const pedidosRows = b.filter((r) => inDate(r.fecha_pedido));
      const cotizaciones = new Set(i.issues.filter((x) => x.emitida_por === s.id).map((x) => x.request_id)).size;
      const ev = i.events.filter((e) => e.created_by === s.id).map((e) => e.created_at);
      const last = [...ev, ...b.map((r) => r.updated_at)].sort().at(-1) ?? null;
      return {
        id: s.id,
        nombre: s.nombre,
        activo: s.activo,
        solicitudes: i.requests.filter((r) => r.vendedor_id === s.id).length,
        cotizacionesEnviadas: cotizaciones,
        pedidos: pedidosRows.length,
        montoPedidos: pedidosRows.reduce((a, r) => a + (r.moneda === "MXN" ? Number(r.monto_venta ?? 0) : 0), 0),
        conversion: cotizaciones ? Math.round((Math.min(pedidosRows.length, cotizaciones) / cotizaciones) * 100) : null,
        ventasActivas: b.filter((r) => r.resultado === "abierta" && r.customers?.tipo === "cliente").length,
        prospectosActivos: b.filter((r) => r.resultado === "abierta" && r.customers?.tipo !== "cliente").length,
        prospectosNuevos: b.filter((r) => r.customers?.tipo !== "cliente" && inDate(dayOf(r.created_at))).length,
        convertidos: i.conversions.filter((c) => c.convertido_por === s.id).length,
        carteraVencida: b.reduce((a, r) => a + (Number(r.cartera_dias_vencidos ?? 0) > 0 ? Number(r.cartera_monto ?? 0) : 0), 0),
        seguimientosVencidos: b.filter((r) => r.resultado === "abierta" && !!r.proximo_seguimiento && r.proximo_seguimiento < i.today).length,
        movimientos: ev.length,
        ultimaActividad: last,
      };
    })
    .sort((a, b) => Number(b.activo) - Number(a.activo) || b.montoPedidos - a.montoPedidos || b.movimientos - a.movimientos || a.nombre.localeCompare(b.nombre));
}

export function totals(rows: SellerSummary[]) {
  const sum = (k: keyof SellerSummary) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const cot = sum("cotizacionesEnviadas");
  return {
    solicitudes: sum("solicitudes"),
    cotizacionesEnviadas: cot,
    pedidos: sum("pedidos"),
    montoPedidos: sum("montoPedidos"),
    conversion: cot ? Math.round((Math.min(sum("pedidos"), cot) / cot) * 100) : null,
    prospectosActivos: sum("prospectosActivos"),
    prospectosNuevos: sum("prospectosNuevos"),
    convertidos: sum("convertidos"),
    carteraVencida: sum("carteraVencida"),
    movimientos: sum("movimientos"),
  };
}
