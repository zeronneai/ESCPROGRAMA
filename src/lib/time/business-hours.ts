import { DateTime } from "luxon";

export interface BusinessHoursConfig {
  /** Zona horaria IANA. */
  timezone: string;
  /** Festivos como fechas ISO yyyy-MM-dd (no cuentan). */
  holidays: readonly string[];
}

export const DEFAULT_TIMEZONE = "America/Chihuahua";

const MS_HOUR = 3_600_000;

function isBusinessDay(dt: DateTime, holidays: ReadonlySet<string>): boolean {
  // Luxon: 1 = lunes ... 7 = domingo
  return dt.weekday <= 5 && !holidays.has(dt.toISODate()!);
}

/** Si dt cae en dia inhabil, regresa el siguiente dia habil a las 00:00. */
function normalizeStart(dt: DateTime, holidays: ReadonlySet<string>): DateTime {
  let cur = dt;
  while (!isBusinessDay(cur, holidays)) {
    cur = cur.startOf("day").plus({ days: 1 });
  }
  return cur;
}

/**
 * Suma horas habiles a `start`. Las horas corren de lunes a viernes; sabados,
 * domingos y festivos no cuentan (el reloj se pausa a las 00:00 y se reanuda
 * a las 00:00 del siguiente dia habil).
 */
export function addBusinessHours(
  start: Date,
  hours: number,
  config: BusinessHoursConfig,
): Date {
  if (hours < 0) throw new RangeError("hours debe ser >= 0");
  const holidays = new Set(config.holidays);
  let cur = normalizeStart(
    DateTime.fromJSDate(start, { zone: config.timezone }),
    holidays,
  );
  let remaining = hours * MS_HOUR;
  for (let guard = 0; guard < 10_000; guard++) {
    const nextMidnight = cur.startOf("day").plus({ days: 1 });
    const available = nextMidnight.toMillis() - cur.toMillis();
    if (remaining <= available) {
      return cur.plus({ milliseconds: remaining }).toJSDate();
    }
    remaining -= available;
    cur = normalizeStart(nextMidnight, holidays);
  }
  throw new Error("addBusinessHours: rango fuera de limites");
}

/**
 * Horas habiles transcurridas entre `from` y `to`. Negativo si to < from.
 */
export function businessHoursBetween(
  from: Date,
  to: Date,
  config: BusinessHoursConfig,
): number {
  if (to.getTime() < from.getTime()) {
    return -businessHoursBetween(to, from, config);
  }
  const holidays = new Set(config.holidays);
  const end = DateTime.fromJSDate(to, { zone: config.timezone });
  let cur = DateTime.fromJSDate(from, { zone: config.timezone });
  let total = 0;
  while (cur.toMillis() < end.toMillis()) {
    const dayEnd = cur.startOf("day").plus({ days: 1 });
    const segmentEnd = dayEnd.toMillis() < end.toMillis() ? dayEnd : end;
    if (isBusinessDay(cur, holidays)) {
      total += segmentEnd.toMillis() - cur.toMillis();
    }
    cur = dayEnd;
  }
  return total / MS_HOUR;
}

export type Semaforo = "verde" | "amarillo" | "rojo" | "vencida";

/** Horas habiles restantes (puede ser negativo si ya vencio). */
export function remainingBusinessHours(
  now: Date,
  dueAt: Date,
  config: BusinessHoursConfig,
): number {
  return businessHoursBetween(now, dueAt, config);
}

/** verde > 24h, amarillo < 24h, rojo < 6h, vencida <= 0. */
export function semaforo(remainingHours: number): Semaforo {
  if (remainingHours <= 0) return "vencida";
  if (remainingHours < 6) return "rojo";
  if (remainingHours < 24) return "amarillo";
  return "verde";
}

/** Una partida esta vencida al consultar si now >= due_at y sigue pendiente. */
export function isOverdue(now: Date, dueAt: Date): boolean {
  return now.getTime() >= dueAt.getTime();
}
