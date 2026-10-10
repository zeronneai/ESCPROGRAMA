import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessHoursConfig } from "@/lib/time/business-hours";
import type { ReferenceRow } from "./types";

export interface BusinessSettings extends BusinessHoursConfig {
  slaHours: number;
  warnHours: number;
  vigenciaDias: number;
}

export async function getBusinessSettings(supabase: SupabaseClient): Promise<BusinessSettings> {
  const [{ data: s }, { data: h }] = await Promise.all([
    supabase.from("app_settings").select("timezone, sla_business_hours, warn_business_hours, vigencia_dias").single(),
    supabase.from("holidays").select("fecha"),
  ]);
  return {
    timezone: s?.timezone ?? "America/Chihuahua",
    slaHours: s?.sla_business_hours ?? 48,
    warnHours: s?.warn_business_hours ?? 12,
    vigenciaDias: s?.vigencia_dias ?? 15,
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

import { DEFAULT_SHIPPING_LEGEND } from "@/lib/pdf/shipping";

export interface CompanyProfile {
  nombre_comercial: string;
  razon_social: string;
  telefono: string;
  web: string;
  direccion: string;
  rfc: string;
  condiciones_default: string;
  pie_lineas: string[];
  leyenda_envio: string;
}

export async function getCompanyProfile(supabase: SupabaseClient): Promise<CompanyProfile> {
  const { data } = await supabase
    .from("company_profile")
    .select("nombre_comercial, razon_social, telefono, web, direccion, rfc, condiciones_default, pie_lineas, leyenda_envio")
    .single();
  return (
    (data as CompanyProfile | null) ?? {
      leyenda_envio: DEFAULT_SHIPPING_LEGEND,
      nombre_comercial: "ESC Representaciones",
      razon_social: "ESC REPRESENTACIONES S. DE R. L. MI.",
      telefono: "(614) 424-6200",
      web: "www.elsauz.com",
      direccion: "H. COLEGIO MILITAR No.5910-C, COL. NOMBRE DE DIOS C.P.31105, CHIHUAHUA, MEXICO",
      rfc: "RFC ERE 060228 NLA",
      condiciones_default: "Credito",
      pie_lineas: ["16% VAT will be added to the invoice", "Prices subject to change"],
    }
  );
}

/** Agrega URL firmada a las imagenes del chat (bucket privado "aclaraciones"). */
export async function withMessageImageUrls<T extends { item_messages?: { image_path: string | null; imageUrl?: string | null }[] }>(
  supabase: SupabaseClient,
  items: T[],
): Promise<T[]> {
  const paths = items.flatMap((i) => (i.item_messages ?? []).map((m) => m.image_path).filter((p): p is string => !!p));
  if (paths.length === 0) return items;
  const { data } = await supabase.storage.from("aclaraciones").createSignedUrls(paths, 3600);
  const map = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return items.map((i) => ({
    ...i,
    item_messages: (i.item_messages ?? []).map((m) => ({ ...m, imageUrl: m.image_path ? (map.get(m.image_path) ?? null) : null })),
  }));
}
