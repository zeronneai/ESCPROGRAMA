import { DateTime } from "luxon";

/** "hoy", "ayer", "hace 3 días", "hace 2 meses". */
export function relativeDays(iso: string | null, now = new Date(), timezone = "America/Chihuahua"): string {
  if (!iso) return "Nunca";
  const d = DateTime.fromISO(iso, { zone: timezone }).startOf("day");
  const t = DateTime.fromJSDate(now).setZone(timezone).startOf("day");
  const days = Math.round(t.diff(d, "days").days);
  if (days <= 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 30) return `Hace ${days} días`;
  const months = Math.round(days / 30);
  return months === 1 ? "Hace 1 mes" : `Hace ${months} meses`;
}

export type FollowUpState = "vencido" | "hoy" | "pronto" | "futuro" | null;

/** Estado del proximo seguimiento (fecha yyyy-MM-dd) respecto a hoy. */
export function followUpState(date: string | null, now = new Date(), timezone = "America/Chihuahua"): FollowUpState {
  if (!date) return null;
  const today = DateTime.fromJSDate(now).setZone(timezone).toISODate()!;
  if (date < today) return "vencido";
  if (date === today) return "hoy";
  const in3 = DateTime.fromJSDate(now).setZone(timezone).plus({ days: 3 }).toISODate()!;
  return date <= in3 ? "pronto" : "futuro";
}

export const FOLLOW_TONE: Record<Exclude<FollowUpState, null>, string> = {
  vencido: "bg-red-100 text-red-800",
  hoy: "bg-amber-100 text-amber-900",
  pronto: "bg-sky-50 text-sky-800",
  futuro: "bg-slate-100 text-slate-600",
};

export function formatFollowUp(date: string | null, now = new Date(), timezone = "America/Chihuahua"): string {
  if (!date) return "Sin agendar";
  const s = followUpState(date, now, timezone);
  if (s === "hoy") return "Hoy";
  const d = DateTime.fromISO(date, { zone: timezone }).setLocale("es-MX");
  const label = d.toFormat("d LLL");
  return s === "vencido" ? `Vencido (${label})` : label;
}

export const money = (v: number | string | null, moneda: string) =>
  v === null || v === "" ? null : `$${Number(v).toLocaleString("es-MX", { maximumFractionDigits: 0 })} ${moneda}`;
