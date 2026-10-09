import { businessHoursBetween, type BusinessHoursConfig } from "@/lib/time/business-hours";

export interface PendingRequest {
  id: string;
  folio: string;
  due_at: string;
}

export interface DeadlineNotice {
  requestId: string;
  folio: string;
  kind: "por_vencer" | "vencida";
  remaining: number;
}

/**
 * Avisos para el comprador: "por_vencer" cuando quedan <= warnHours horas habiles y
 * "vencida" cuando el plazo ya se cumplio. Solo recibe solicitudes con partidas pendientes.
 */
export function computeDeadlineNotices(
  pending: PendingRequest[],
  now: Date,
  cfg: BusinessHoursConfig & { warnHours: number },
): DeadlineNotice[] {
  const out: DeadlineNotice[] = [];
  for (const r of pending) {
    const remaining = businessHoursBetween(now, new Date(r.due_at), cfg);
    if (remaining <= 0) out.push({ requestId: r.id, folio: r.folio, kind: "vencida", remaining });
    else if (remaining <= cfg.warnHours) out.push({ requestId: r.id, folio: r.folio, kind: "por_vencer", remaining });
  }
  return out;
}

export const DIAS_SIN_RESULTADO = 15;

export interface DispatchedItem {
  itemId: string;
  requestId: string;
  folio: string;
  producto: string;
  vendedorId: string;
  /** Fecha del envio al cliente de la version vigente. */
  enviadoAt: string;
  resultado: "sin_respuesta" | "ganada" | "perdida";
}

/** Cotizaciones enviadas que llevan mas de `days` dias naturales sin resultado (aviso al vendedor). */
export function computeSinResultado(items: DispatchedItem[], now: Date, days = DIAS_SIN_RESULTADO): DispatchedItem[] {
  const limit = now.getTime() - days * 86_400_000;
  return items.filter((i) => i.resultado === "sin_respuesta" && new Date(i.enviadoAt).getTime() < limit);
}
