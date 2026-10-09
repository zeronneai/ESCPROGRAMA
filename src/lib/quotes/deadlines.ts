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
