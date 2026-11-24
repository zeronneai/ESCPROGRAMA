import type { SupabaseClient } from "@supabase/supabase-js";

export interface FacturaConc {
  id: string;
  folio: string;
  venta_id: string | null;
  vendedor_id: string;
  marco_pagada: boolean;
  pagada: boolean; // la venta ya esta pagada (por este abono o antes)
}
export interface MovConc {
  id: string;
  conciliacion_id: string;
  banco: string;
  cuenta: string | null;
  moneda: string;
  fecha: string;
  descripcion: string;
  referencia: string | null;
  monto: number;
  tomado_por: string | null;
  tomado_nombre: string | null;
  tomado_at: string | null;
  facturas: FacturaConc[];
}

/** Abonos de las conciliaciones (mas recientes primero) con las facturas que los vendedores les pusieron. */
export async function cargarMovimientos(supabase: SupabaseClient, opts: { conciliacionId?: string; limite?: number } = {}): Promise<{ movs: MovConc[]; error: string | null }> {
  let q = supabase
    .from("conciliacion_movimientos")
    .select("id, conciliacion_id, banco, cuenta, moneda, fecha, descripcion, referencia, monto, tomado_por, tomado_nombre, tomado_at")
    .order("fecha", { ascending: false })
    .order("monto", { ascending: false })
    .limit(opts.limite ?? 1500);
  if (opts.conciliacionId) q = q.eq("conciliacion_id", opts.conciliacionId);
  const { data, error } = await q;
  if (error) return { movs: [], error: error.message };
  const ids = (data ?? []).filter((m) => m.tomado_por).map((m) => m.id as string);
  const facts = new Map<string, FacturaConc[]>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data: fs } = await supabase
      .from("conciliacion_facturas")
      .select("id, movimiento_id, folio, venta_id, vendedor_id, marco_pagada, ventas(porcentaje_cobrado)")
      .in("movimiento_id", ids.slice(i, i + 300));
    type F = { id: string; movimiento_id: string; folio: string; venta_id: string | null; vendedor_id: string; marco_pagada: boolean; ventas: { porcentaje_cobrado: string } | null };
    for (const f of (fs ?? []) as unknown as F[]) {
      const l = facts.get(f.movimiento_id) ?? [];
      l.push({ id: f.id, folio: f.folio, venta_id: f.venta_id, vendedor_id: f.vendedor_id, marco_pagada: f.marco_pagada, pagada: Number(f.ventas?.porcentaje_cobrado ?? 0) >= 100 });
      facts.set(f.movimiento_id, l);
    }
  }
  return {
    movs: (data ?? []).map((m) => ({ ...(m as Omit<MovConc, "monto" | "facturas">), monto: Number(m.monto), facturas: facts.get(m.id as string) ?? [] })),
    error: null,
  };
}

/** Posibles folios de factura en la descripcion del banco ("F11488", "PMC146", "FACT 10872"). */
export function foliosSugeridos(desc: string): string[] {
  const out = new Set<string>();
  for (const m of desc.toUpperCase().matchAll(/\b(F|PMC|PMV|VPI|FAC|FACT|FACTURA|ESC-?)\s?-?(\d{3,6})\b/g)) {
    const pre = m[1].startsWith("FAC") ? "" : m[1].replace(/-$/, "");
    out.add(pre ? `${pre}${m[2]}` : m[2]);
  }
  return [...out].slice(0, 6);
}
