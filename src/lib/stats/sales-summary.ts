import { DateTime } from "luxon";
import type { BitacoraRow } from "@/lib/bitacora/stages";
import { cobroEstado, saldo, type VentaRow } from "@/lib/ventas";

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

export type SummaryBitacora = Pick<BitacoraRow, "vendedor_id" | "resultado" | "proximo_seguimiento" | "created_at" | "updated_at" | "archived_at">;

export type SummaryVenta = Pick<VentaRow, "vendedor_id" | "fecha" | "monto" | "moneda" | "pago" | "vence" | "porcentaje_cobrado" | "cancelada_at" | "request_id" | "created_at">;

export interface SummaryInput {
  sellers: { id: string; nombre: string; activo: boolean }[];
  /** Solicitudes enviadas a compras en el periodo. */
  requests: { vendedor_id: string; submitted_at: string }[];
  /** Cotizaciones registradas como enviadas al cliente en el periodo. */
  issues: { emitida_por: string; request_id: string; emitida_at: string }[];
  /** Prospeccion (seguimiento por etapas). */
  bitacora: SummaryBitacora[];
  /** Ventas diarias (todas: el periodo se filtra aqui; la cartera es al dia de hoy). */
  ventas: SummaryVenta[];
  /** Prospectos convertidos a cliente en el periodo. */
  conversions: { convertido_por: string | null }[];
  /** Movimientos de prospeccion en el periodo. */
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
  ventas: number;
  montoVentas: number;
  conversion: number | null;
  porCobrar: number;
  carteraVencida: number;
  prospectosActivos: number;
  prospectosNuevos: number;
  convertidos: number;
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
      const v = i.ventas.filter((x) => x.vendedor_id === s.id && !x.cancelada_at);
      const vp = v.filter((x) => inDate(x.fecha));
      const cotizaciones = new Set(i.issues.filter((x) => x.emitida_por === s.id).map((x) => x.request_id)).size;
      const ganadas = new Set(vp.filter((x) => x.request_id).map((x) => x.request_id)).size;
      const ev = i.events.filter((e) => e.created_by === s.id).map((e) => e.created_at);
      const last = [...ev, ...b.map((r) => r.updated_at), ...v.map((x) => x.created_at)].sort().at(-1) ?? null;
      const st = v.map((x) => ({ x, e: cobroEstado(x, i.today) }));
      return {
        id: s.id,
        nombre: s.nombre,
        activo: s.activo,
        solicitudes: i.requests.filter((r) => r.vendedor_id === s.id).length,
        cotizacionesEnviadas: cotizaciones,
        ventas: vp.length,
        montoVentas: vp.reduce((a, x) => a + (x.moneda === "MXN" ? Number(x.monto ?? 0) : 0), 0),
        conversion: cotizaciones ? Math.round((Math.min(ganadas, cotizaciones) / cotizaciones) * 100) : null,
        porCobrar: st.filter((y) => y.e === "por_cobrar").reduce((a, y) => a + saldo(y.x), 0),
        carteraVencida: st.filter((y) => y.e === "vencida").reduce((a, y) => a + saldo(y.x), 0),
        prospectosActivos: b.filter((r) => r.resultado === "abierta").length,
        prospectosNuevos: b.filter((r) => inDate(dayOf(r.created_at))).length,
        convertidos: i.conversions.filter((c) => c.convertido_por === s.id).length,
        seguimientosVencidos: b.filter((r) => r.resultado === "abierta" && !!r.proximo_seguimiento && r.proximo_seguimiento < i.today).length,
        movimientos: ev.length + v.filter((x) => inDate(dayOf(x.created_at))).length,
        ultimaActividad: last,
      };
    })
    .sort((a, b) => Number(b.activo) - Number(a.activo) || b.montoVentas - a.montoVentas || b.movimientos - a.movimientos || a.nombre.localeCompare(b.nombre));
}

export function totals(rows: SellerSummary[]) {
  const sum = (k: keyof SellerSummary) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return {
    solicitudes: sum("solicitudes"),
    cotizacionesEnviadas: sum("cotizacionesEnviadas"),
    ventas: sum("ventas"),
    montoVentas: sum("montoVentas"),
    porCobrar: sum("porCobrar"),
    carteraVencida: sum("carteraVencida"),
    prospectosActivos: sum("prospectosActivos"),
    prospectosNuevos: sum("prospectosNuevos"),
    convertidos: sum("convertidos"),
    movimientos: sum("movimientos"),
  };
}
