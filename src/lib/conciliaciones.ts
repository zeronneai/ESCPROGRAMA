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
  /** Cuando se subio (de ahi cuentan los 7 dias para identificarlo). */
  created_at: string;
  /** Se identifico despues de los 7 dias (comision -10%, siguiente quincena). */
  tardio: boolean;
  /** A nombre de quien lo identifico la jefa, la gerente o el CEO. */
  tomado_para: string | null;
  /** El vendedor dueno del pago (si lo identifico la direccion a su nombre, no es quien lo tomo). */
  vendedor_id: string | null;
  /** Se identifico antes del portal (a mano): ya no se toca. */
  previo?: boolean;
  previo_nota?: string | null;
  facturas: FacturaConc[];
}

export const PLAZO_DIAS = 7;
/** Dias que le quedan para identificarlo (negativo = ya vencio). */
export const diasRestantes = (creado: string, ahora = Date.now()) => Math.ceil((new Date(creado).getTime() + PLAZO_DIAS * 86400_000 - ahora) / 86400_000);

/** Abonos de las conciliaciones (mas recientes primero) con las facturas que los vendedores les pusieron. */
export async function cargarMovimientos(supabase: SupabaseClient, opts: { conciliacionId?: string; limite?: number } = {}): Promise<{ movs: MovConc[]; error: string | null }> {
  const armar = (cols: string) => {
    let q = supabase.from("conciliacion_movimientos").select(cols).order("fecha", { ascending: false }).order("monto", { ascending: false }).limit(opts.limite ?? 1500);
    if (opts.conciliacionId) q = q.eq("conciliacion_id", opts.conciliacionId);
    return q;
  };
  const base = "id, conciliacion_id, banco, cuenta, moneda, fecha, descripcion, referencia, monto, tomado_por, tomado_nombre, tomado_at, created_at";
  // Sin la actualizacion 0077 todavia no hay plazo ni identificacion a nombre de otro.
  let r = await armar(`${base}, tardio, tomado_para, vendedor_id, previo, previo_nota`);
  if (r.error && /previo/.test(r.error.message)) r = await armar(`${base}, tardio, tomado_para, vendedor_id`);
  if (r.error && /tardio|tomado_para|vendedor_id/.test(r.error.message)) r = await armar(base);
  const { error } = r;
  const data = (r.data ?? []) as unknown as Record<string, unknown>[];
  if (error) return { movs: [], error: error.message };
  const ids = data.filter((m) => m.tomado_por).map((m) => m.id as string);
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
    movs: data.map((m) => ({ ...(m as unknown as Omit<MovConc, "monto" | "facturas" | "tardio" | "tomado_para" | "vendedor_id">), tardio: !!m.tardio, tomado_para: (m.tomado_para as string | null) ?? null, previo: !!m.previo, previo_nota: (m.previo_nota as string | null) ?? null, vendedor_id: (m.vendedor_id as string | null) ?? (m.tomado_para ? null : (m.tomado_por as string | null)), monto: Number(m.monto), facturas: facts.get(m.id as string) ?? [] })),
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
