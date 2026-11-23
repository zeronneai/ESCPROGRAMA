import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import type { VentaCandidata } from "@/components/bitacora-unir";

/** Ventas recientes del vendedor a OTROS clientes: por si la factura del prospecto salio con otro nombre. */
export async function ventasCandidatas(supabase: SupabaseClient, vendedorId: string, propios: (string | null | undefined)[], tz: string): Promise<VentaCandidata[]> {
  const desde = DateTime.now().setZone(tz).minus({ days: 120 }).toISODate()!;
  const { data } = await supabase
    .from("ventas")
    .select("customer_id, factura, fecha, monto, moneda, customers(nombre, parent_id)")
    .eq("vendedor_id", vendedorId)
    .eq("tipo", "venta")
    .is("cancelada_at", null)
    .gte("fecha", desde)
    .order("fecha", { ascending: false })
    .limit(60);
  const propio = new Set(propios.filter(Boolean) as string[]);
  type VRow = { customer_id: string; factura: string | null; fecha: string; monto: string | null; moneda: string; customers: { nombre: string; parent_id: string | null } | null };
  return ((data ?? []) as unknown as VRow[])
    .filter((v) => !propio.has(v.customer_id) && !propio.has(v.customers?.parent_id ?? ""))
    .map((v) => ({ customer_id: v.customer_id, cliente: v.customers?.nombre ?? "Cliente", factura: v.factura, fecha: v.fecha.slice(0, 10), monto: v.monto == null ? null : Number(v.monto), moneda: v.moneda }));
}
