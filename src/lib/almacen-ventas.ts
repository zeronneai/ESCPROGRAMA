import type { SupabaseClient } from "@supabase/supabase-js";

/** Rutas que se esconden mientras almacen no esta conectado a ventas (no hay inventario todavia). */
export const RUTAS_ALMACEN_VENTAS = ["/entregas", "/almacen/inventario"];

/**
 * Interruptor "Almacen conectado a ventas" (Configuracion). Apagado: la venta con factura no manda carga a
 * almacen y se esconden Entregas e Inventario. Sin la actualizacion 0047 la base sigue conectada, asi que se
 * responde que si.
 */
export async function almacenVentasActivo(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.from("company_profile").select("almacen_ventas").limit(1).maybeSingle();
  if (error) return true;
  return Boolean((data as { almacen_ventas?: boolean } | null)?.almacen_ventas);
}
