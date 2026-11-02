import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Liga temporal (1 hora) para descargar un archivo privado. */
export async function signedUrl(supabase: SupabaseClient, bucket: string, path: string | null, name?: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600, name ? { download: name } : undefined);
  return data?.signedUrl ?? null;
}

export const fmtDate = (iso: string | null | undefined, tz: string, withTime = true) =>
  iso
    ? new Date(iso).toLocaleString("es-MX", { timeZone: tz, day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) })
    : "";
export const fmtDay = (d: string | null | undefined) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "");
