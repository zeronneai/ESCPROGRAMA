import type { SupabaseClient } from "@supabase/supabase-js";

export type FacturaPo = { oc_id: string; po_numero: string; venta_id: string; factura: string | null; fecha: string; moneda: string; total: number | null; subtotal: number | null };

/** Facturas de cada P/O de Pegatron (por la orden de compra leida de la factura). Vacio si falta la 0091. */
export async function facturasPorOc(supabase: SupabaseClient): Promise<Map<string, FacturaPo[]>> {
  const { data, error } = await supabase.rpc("pegatron_facturado");
  const m = new Map<string, FacturaPo[]>();
  if (error) return m;
  for (const r of (data ?? []) as FacturaPo[]) {
    const l = m.get(r.oc_id) ?? [];
    l.push({ ...r, total: r.total == null ? null : Number(r.total), subtotal: r.subtotal == null ? null : Number(r.subtotal) });
    m.set(r.oc_id, l);
  }
  return m;
}

export const fechaCorta = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
export const importe = (n: number | null, mon: string) => (n == null ? "" : `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${mon === "USD" ? " USD" : ""}`);
