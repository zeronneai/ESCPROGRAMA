import { DateTime } from "luxon";
import type { ItemStatus } from "@/lib/quotes/types";

/** Una fila por partida enviada (datos planos para estadisticas y exportaciones). */
export interface StatRow {
  requestId: string;
  requestFolio: string;
  submittedAt: string;
  dueAt: string;
  vendedorId: string;
  vendedorNombre: string;
  customerId: string;
  customerNombre: string;
  itemId: string;
  estado: ItemStatus;
  firstResponseAt: string | null;
  responseHours: number | null;
  notFoundNote: string | null;
  moneda: "MXN" | "USD" | null;
  precioElegido: number | null;
}

export interface Count {
  label: string;
  count: number;
}

export interface BuyerStats {
  totalPartidas: number;
  solicitudes: number;
  respondidas: number;
  cotizadas: number;
  noEncontradas: number;
  enviadas: number;
  tasaRespuesta: number | null;
  /** Porcentaje (0 a 1) de respondidas con first_response_at <= due_at. */
  dentroDePlazo: number | null;
  promedioHoras: number | null;
  tasaNoEncontrada: number | null;
  pctEnviado: number | null;
  razones: Count[];
  porVendedor: Count[];
  porCliente: Count[];
  porMes: Count[];
  distribucionPrecio: Count[];
  tendenciaSemanal: { semana: string; enviadas: number; respondidas: number }[];
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

function tally(keys: string[]): Count[] {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function normalizeReason(note: string): string {
  return note.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
}

export function computeBuyerStats(rows: StatRow[], timezone = "America/Chihuahua"): BuyerStats {
  const responded = rows.filter((r) => r.firstResponseAt);
  const cotizadas = rows.filter((r) => r.estado === "cotizada" || r.estado === "enviada_cliente");
  const noEnc = rows.filter((r) => r.estado === "no_encontrada");
  const enviadas = rows.filter((r) => r.estado === "enviada_cliente");

  const onTime = responded.filter((r) => new Date(r.firstResponseAt!).getTime() <= new Date(r.dueAt).getTime());
  const hours = responded.map((r) => r.responseHours).filter((h): h is number => h !== null);

  const month = (iso: string) => DateTime.fromISO(iso, { zone: timezone }).toFormat("yyyy-MM");
  const week = (iso: string) => DateTime.fromISO(iso, { zone: timezone }).startOf("week").toISODate()!;

  const weeks = new Map<string, { enviadas: number; respondidas: number }>();
  for (const r of rows) {
    const k = week(r.submittedAt);
    const w = weeks.get(k) ?? { enviadas: 0, respondidas: 0 };
    w.enviadas++;
    if (r.firstResponseAt) w.respondidas++;
    weeks.set(k, w);
  }

  const picks = [1, 2, 3, 4, 5].map((p) => ({ label: `Precio ${p}`, count: enviadas.filter((r) => r.precioElegido === p).length }));

  return {
    totalPartidas: rows.length,
    solicitudes: new Set(rows.map((r) => r.requestId)).size,
    respondidas: responded.length,
    cotizadas: cotizadas.length,
    noEncontradas: noEnc.length,
    enviadas: enviadas.length,
    tasaRespuesta: ratio(responded.length, rows.length),
    dentroDePlazo: ratio(onTime.length, responded.length),
    promedioHoras: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
    tasaNoEncontrada: ratio(noEnc.length, responded.length),
    pctEnviado: ratio(enviadas.length, cotizadas.length),
    razones: tally(noEnc.filter((r) => r.notFoundNote).map((r) => normalizeReason(r.notFoundNote!))).slice(0, 10),
    porVendedor: tally(cotizadas.map((r) => r.vendedorNombre)),
    porCliente: tally(cotizadas.map((r) => r.customerNombre)),
    porMes: tally(cotizadas.map((r) => month(r.submittedAt))).sort((a, b) => a.label.localeCompare(b.label)),
    distribucionPrecio: picks,
    tendenciaSemanal: [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([semana, v]) => ({ semana, ...v })),
  };
}
