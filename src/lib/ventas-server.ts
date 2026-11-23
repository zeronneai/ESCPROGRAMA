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
    supabase
      .from("venta_lineas")
      .select("id, articulo_id, descripcion, cantidad, importe, comision_pct, comision, articulos(clave)")
      .eq("venta_id", id)
      .order("created_at")
      .then((r) => (r.error ? supabase.from("venta_lineas").select("id, articulo_id, descripcion, cantidad, articulos(clave)").eq("venta_id", id).order("created_at") : r)),
    venta.request_id ? supabase.from("quote_requests").select("folio").eq("id", venta.request_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("profiles").select("nombre").eq("id", venta.vendedor_id).maybeSingle(),
  ]);
  type LRow = { id: string; articulo_id: string | null; descripcion: string; cantidad: number | null; articulos: unknown; importe?: number | null; comision_pct?: number | null; comision?: number | null };
  const lineas: VentaLinea[] = ((ls ?? []) as unknown as LRow[]).map((l) => ({
    id: l.id, articulo_id: l.articulo_id, descripcion: l.descripcion, cantidad: l.cantidad === null ? null : Number(l.cantidad),
    clave: (l.articulos as unknown as { clave: string } | null)?.clave ?? null,
    importe: l.importe == null ? null : Number(l.importe),
    comision_pct: l.comision_pct == null ? null : Number(l.comision_pct),
    comision: l.comision == null ? null : Number(l.comision),
  }));
  return { venta, customer: c, lineas, folio: (r as { folio: string | null } | null)?.folio ?? null, vendedor: (p as { nombre: string } | null)?.nombre ?? null };
}
