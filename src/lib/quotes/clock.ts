import { addBusinessHours, businessHoursBetween, type BusinessHoursConfig } from "@/lib/time/business-hours";

export interface PauseInterval {
  clarification_requested_at: string;
  resumed_at: string | null;
}

/** Horas habiles que el reloj estuvo en pausa (aclaraciones), hasta `until`. */
export function pausedBusinessHours(pauses: PauseInterval[], until: Date, cfg: BusinessHoursConfig): number {
  let total = 0;
  for (const p of pauses) {
    const from = new Date(p.clarification_requested_at);
    const to = p.resumed_at ? new Date(p.resumed_at) : until;
    const end = to.getTime() < until.getTime() ? to : until;
    if (end.getTime() > from.getTime()) total += businessHoursBetween(from, end, cfg);
  }
  return total;
}

/**
 * Vencimiento efectivo de una partida: due_at (inmutable) desplazado por las horas habiles
 * que estuvo en pausa por aclaraciones.
 */
export function effectiveDueAt(dueAt: Date, pauses: PauseInterval[], now: Date, cfg: BusinessHoursConfig): Date {
  const paused = pausedBusinessHours(pauses, now, cfg);
  return paused > 0 ? addBusinessHours(dueAt, paused, cfg) : dueAt;
}

/** Horas habiles restantes con las pausas descontadas (constante mientras la partida esta en pausa). */
export function remainingWithPauses(dueAt: Date, pauses: PauseInterval[], now: Date, cfg: BusinessHoursConfig): number {
  return businessHoursBetween(now, effectiveDueAt(dueAt, pauses, now, cfg), cfg);
}

/** Tiempo de respuesta en horas habiles, sin contar el tiempo en pausa. */
export function netResponseHours(submittedAt: Date, respondedAt: Date, pauses: PauseInterval[], cfg: BusinessHoursConfig): number {
  const gross = businessHoursBetween(submittedAt, respondedAt, cfg);
  return Math.max(0, gross - pausedBusinessHours(pauses, respondedAt, cfg));
}
