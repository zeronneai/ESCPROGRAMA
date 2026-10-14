import { DateTime } from "luxon";
import {
  CONTACT_KINDS,
  LEAD_SOURCES,
  OPEN_STAGES,
  SOURCE_LABEL,
  STAGE_SHORT,
  isClosed,
  type ActivityKind,
  type LeadSource,
  type LeadStage,
} from "./types";

export interface StatLead {
  etapa: LeadStage;
  origen: LeadSource;
  created_at: string;
  ganado_at: string | null;
  etapa_at: string;
  proximo_seguimiento: string | null;
  valor_estimado: number | string | null;
  moneda: "MXN" | "USD";
  archived_at: string | null;
}
export interface StatActivity {
  tipo: ActivityKind;
  created_at: string;
  etapa_despues?: LeadStage | null;
}

export interface LeadStats {
  total: number;
  activos: number;
  nuevosMes: number;
  ganados: number;
  ganadosMes: number;
  perdidos: number;
  /** ganados / (ganados + perdidos); null sin cerrados. */
  tasaConversion: number | null;
  sinContactar: number;
  seguimientosVencidos: number;
  seguimientosHoy: number;
  contactosMes: { llamadas: number; mensajes: number; correos: number; visitas: number; total: number };
  porEtapa: { etapa: LeadStage; label: string; count: number }[];
  porOrigen: { label: string; count: number; ganados: number }[];
  actividadSemanal: { semana: string; llamadas: number; mensajes: number; visitas: number }[];
  porMes: { mes: string; nuevos: number; ganados: number }[];
  pipeline: { moneda: "MXN" | "USD"; valor: number; leads: number }[];
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Indicadores del modulo de leads. Pura: recibe filas ya filtradas (las del vendedor). */
export function computeLeadStats(
  leads: StatLead[],
  activities: StatActivity[],
  now: Date = new Date(),
  timezone = "America/Chihuahua",
  weeks = 8,
  months = 6,
): LeadStats {
  const t = DateTime.fromJSDate(now).setZone(timezone);
  const monthStart = t.startOf("month");
  const today = t.toISODate()!;
  const live = leads.filter((l) => !l.archived_at);
  const open = live.filter((l) => !isClosed(l.etapa));
  const inMonth = (iso: string | null) => !!iso && DateTime.fromISO(iso, { zone: timezone }) >= monthStart;

  const ganados = live.filter((l) => l.etapa === "ganado");
  const perdidos = live.filter((l) => l.etapa === "perdido");

  const monthActs = activities.filter((a) => inMonth(a.created_at));
  const count = (kinds: ActivityKind[]) => monthActs.filter((a) => kinds.includes(a.tipo)).length;

  // Semanas (lunes) de la mas antigua a la actual.
  const weekKeys = Array.from({ length: weeks }, (_, i) => t.startOf("week").minus({ weeks: weeks - 1 - i }).toISODate()!);
  const weekly = new Map(weekKeys.map((k) => [k, { semana: k, llamadas: 0, mensajes: 0, visitas: 0 }]));
  for (const a of activities) {
    const k = DateTime.fromISO(a.created_at, { zone: timezone }).startOf("week").toISODate()!;
    const w = weekly.get(k);
    if (!w) continue;
    if (a.tipo === "llamada") w.llamadas++;
    else if (a.tipo === "whatsapp" || a.tipo === "correo") w.mensajes++;
    else if (a.tipo === "visita" || a.tipo === "reunion" || a.tipo === "muestra") w.visitas++;
  }

  const monthKeys = Array.from({ length: months }, (_, i) => t.startOf("month").minus({ months: months - 1 - i }).toFormat("yyyy-MM"));
  const monthly = new Map(monthKeys.map((k) => [k, { mes: k, nuevos: 0, ganados: 0 }]));
  for (const l of live) {
    const m = monthly.get(DateTime.fromISO(l.created_at, { zone: timezone }).toFormat("yyyy-MM"));
    if (m) m.nuevos++;
    if (l.ganado_at) {
      const g = monthly.get(DateTime.fromISO(l.ganado_at, { zone: timezone }).toFormat("yyyy-MM"));
      if (g) g.ganados++;
    }
  }

  const pipeline = (["MXN", "USD"] as const)
    .map((moneda) => {
      const mine = open.filter((l) => l.moneda === moneda && l.valor_estimado !== null && l.valor_estimado !== "");
      return { moneda, valor: mine.reduce((s, l) => s + Number(l.valor_estimado), 0), leads: mine.length };
    })
    .filter((p) => p.leads > 0);

  return {
    total: live.length,
    activos: open.length,
    nuevosMes: live.filter((l) => inMonth(l.created_at)).length,
    ganados: ganados.length,
    ganadosMes: ganados.filter((l) => inMonth(l.ganado_at)).length,
    perdidos: perdidos.length,
    tasaConversion: ratio(ganados.length, ganados.length + perdidos.length),
    sinContactar: open.filter((l) => l.etapa === "nuevo").length,
    seguimientosVencidos: open.filter((l) => l.proximo_seguimiento && l.proximo_seguimiento < today).length,
    seguimientosHoy: open.filter((l) => l.proximo_seguimiento === today).length,
    contactosMes: {
      llamadas: count(["llamada"]),
      mensajes: count(["whatsapp"]),
      correos: count(["correo"]),
      visitas: count(["visita", "reunion"]),
      total: monthActs.filter((a) => CONTACT_KINDS.includes(a.tipo)).length,
    },
    porEtapa: [...OPEN_STAGES, "ganado" as const, "perdido" as const].map((etapa) => ({
      etapa,
      label: STAGE_SHORT[etapa],
      count: live.filter((l) => l.etapa === etapa).length,
    })),
    porOrigen: LEAD_SOURCES.map((o) => ({
      label: SOURCE_LABEL[o],
      count: live.filter((l) => l.origen === o).length,
      ganados: ganados.filter((l) => l.origen === o).length,
    }))
      .filter((o) => o.count > 0)
      .sort((a, b) => b.count - a.count),
    actividadSemanal: [...weekly.values()],
    porMes: [...monthly.values()],
    pipeline,
  };
}
