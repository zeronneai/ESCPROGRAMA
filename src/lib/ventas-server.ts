import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { VENTA_COLS, type VentaLinea, type VentaRow } from "@/lib/ventas";

export const CUST_MIN = "id, nombre, tipo, contacto_nombre, contacto_telefono, giro, estado_geo";

export async function loadVenta(supabase: SupabaseClient, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: v } = await supabase.from("ventas").select(VENTA_COLS).eq("id", id).maybeSingle();
  if (!v) return null;
  const venta = v as unknown as VentaRow;
  const [{ data: c }, { data: ls }, { data: r }, { data: p }] = await Promise.all([
    supabase.from("customers").select(CUST_MIN).eq("id", venta.customer_id).maybeSingle(),
    supabase.from("venta_lineas").select("id, articulo_id, descripcion, cantidad, articulos(clave)").eq("venta_id", id).order("created_at"),
    venta.request_id ? supabase.from("quote_requests").select("folio").eq("id", venta.request_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("profiles").select("nombre").eq("id", venta.vendedor_id).maybeSingle(),
  ]);
  const lineas: VentaLinea[] = (ls ?? []).map((l) => ({
    id: l.id, articulo_id: l.articulo_id, descripcion: l.descripcion, cantidad: l.cantidad === null ? null : Number(l.cantidad),
    clave: (l.articulos as unknown as { clave: string } | null)?.clave ?? null,
  }));
  return { venta, customer: c, lineas, folio: (r as { folio: string | null } | null)?.folio ?? null, vendedor: (p as { nombre: string } | null)?.nombre ?? null };
}

/**
 * Agrega el tipo de cambio a las ventas en USD (para sumarlas en pesos).
 * Si la base todavia no tiene la actualizacion 0071, regresa las ventas igual.
 */
export async function conTipoCambio<T extends { id?: string; moneda: string }>(supabase: SupabaseClient, rows: T[]): Promise<(T & { tipo_cambio: number | null })[]> {
  const ids = [...new Set(rows.filter((r) => r.moneda === "USD" && r.id).map((r) => r.id!))];
  const tc = new Map<string, number | null>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await supabase.from("ventas").select("id, tipo_cambio").in("id", ids.slice(i, i + 300));
    if (error) break;
    for (const d of data ?? []) tc.set(d.id as string, d.tipo_cambio == null ? null : Number(d.tipo_cambio));
  }
  return rows.map((r) => ({ ...r, tipo_cambio: r.id ? (tc.get(r.id) ?? null) : null }));
}
