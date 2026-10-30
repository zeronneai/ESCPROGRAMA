import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BitacoraEvent } from "@/components/bitacora-editor";
import type { BitacoraRow } from "@/lib/bitacora/stages";
import { CUSTOMER_COLS, type CustomerRecord } from "@/lib/validation/customer";

export interface BitacoraDetail {
  entry: BitacoraRow & { profiles: { nombre: string } | null };
  customer: CustomerRecord | null;
  events: BitacoraEvent[];
  requests: { id: string; folio: string; submitted_at: string | null }[];
}

/** Carga un registro con su cliente, movimientos y solicitudes del portal del mismo cliente (RLS decide que se ve). */
export async function loadBitacoraDetail(supabase: SupabaseClient, id: string): Promise<BitacoraDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: entry } = await supabase
    .from("bitacora")
    .select("*, profiles:profiles!bitacora_vendedor_id_fkey(nombre)")
    .eq("id", id)
    .maybeSingle();
  if (!entry) return null;
  const [{ data: customer }, { data: ev }, { data: reqs }] = await Promise.all([
    supabase.from("customers").select(CUSTOMER_COLS).eq("id", entry.customer_id).maybeSingle(),
    supabase
      .from("bitacora_eventos")
      .select("id, tipo, etapa, nota, created_at, profiles:profiles!bitacora_eventos_created_by_fkey(nombre)")
      .eq("bitacora_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("quote_requests")
      .select("id, folio, submitted_at")
      .eq("customer_id", entry.customer_id)
      .not("folio", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(50),
  ]);
  return {
    entry: entry as BitacoraDetail["entry"],
    customer: (customer as CustomerRecord | null) ?? null,
    events: (ev ?? []).map((e) => {
      const p = e.profiles as unknown as { nombre: string } | null;
      return { id: e.id, tipo: e.tipo, etapa: e.etapa, nota: e.nota, created_at: e.created_at, autor: p?.nombre ?? null };
    }),
    requests: (reqs ?? []).filter((r) => r.folio) as BitacoraDetail["requests"],
  };
}
