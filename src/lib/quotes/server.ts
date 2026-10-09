import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessHoursConfig } from "@/lib/time/business-hours";
import type { ReferenceRow } from "./types";

export interface BusinessSettings extends BusinessHoursConfig {
  slaHours: number;
  warnHours: number;
}

export async function getBusinessSettings(supabase: SupabaseClient): Promise<BusinessSettings> {
  const [{ data: s }, { data: h }] = await Promise.all([
    supabase.from("app_settings").select("timezone, sla_business_hours, warn_business_hours").single(),
    supabase.from("holidays").select("fecha"),
  ]);
  return {
    timezone: s?.timezone ?? "America/Chihuahua",
    slaHours: s?.sla_business_hours ?? 48,
    warnHours: s?.warn_business_hours ?? 12,
    holidays: (h ?? []).map((x: { fecha: string }) => x.fecha),
  };
}

/** Agrega URL firmada a las imagenes (bucket privado). */
export async function withSignedUrls<T extends { item_references?: ReferenceRow[] }>(
  supabase: SupabaseClient,
  items: T[],
): Promise<T[]> {
  const paths = items.flatMap((i) => (i.item_references ?? []).filter((r) => r.tipo === "imagen").map((r) => r.url));
  if (paths.length === 0) return items;
  const { data } = await supabase.storage.from("references").createSignedUrls(paths, 3600);
  const map = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return items.map((i) => ({
    ...i,
    item_references: (i.item_references ?? []).map((r) => ({
      ...r,
      signedUrl: r.tipo === "imagen" ? (map.get(r.url) ?? null) : null,
    })),
  }));
}

/** Traduce errores de Postgres/RLS a mensajes para el usuario. */
export function friendlyError(message: string | undefined): string {
  if (!message) return "Ocurrio un error. Intenta de nuevo.";
  if (/row-level security|permission denied|No autorizado/i.test(message)) {
    return "No tienes permiso para realizar esta accion.";
  }
  if (/duplicate key/i.test(message)) return "Ese registro ya existe.";
  return message;
}
