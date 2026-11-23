import type { SupabaseClient } from "@supabase/supabase-js";

export type EstadoRecepcion = "por_revisar" | "recibida" | "rechazada";
export const FORMAS_PAGO = { transferencia: "Transferencia", deposito: "Depósito", cheque: "Cheque", efectivo: "Efectivo", otro: "Otro" } as const;
export type FormaPago = keyof typeof FORMAS_PAGO;

export interface FacturaRec {
  id: string;
  venta_id: string;
  estado: EstadoRecepcion;
  motivo: string | null;
  revisado_at: string | null;
  factura: string | null;
  cliente: string;
  fecha_factura: string;
  monto: number;
  moneda: string;
}
export interface PagoRec {
  id: string;
  fecha: string;
  monto: number;
  moneda: string;
  forma: FormaPago;
  referencia: string | null;
  facturas: FacturaRec[];
}
export interface NotaRec {
  id: string;
  texto: string;
  autor_nombre: string | null;
  created_by: string | null;
  created_at: string;
}
export interface EntregaRec {
  id: string;
  folio: string;
  notas: string | null;
  estado: "por_revisar" | "revisada";
  created_at: string;
  pagos: PagoRec[];
  notasLista: NotaRec[];
}

/** Entregas de facturas de un vendedor, con sus pagos, facturas y anotaciones (mas recientes primero). */
export async function cargarEntregas(supabase: SupabaseClient, vendedorId: string, limite = 60): Promise<{ entregas: EntregaRec[]; error: string | null }> {
  const { data: ents, error } = await supabase
    .from("factura_entregas")
    .select("id, folio, notas, estado, created_at")
    .eq("vendedor_id", vendedorId)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) return { entregas: [], error: error.message };
  const ids = (ents ?? []).map((e) => e.id as string);
  if (!ids.length) return { entregas: [], error: null };
  const [{ data: pagos }, { data: recs }, { data: notas }] = await Promise.all([
    supabase.from("cobro_pagos").select("id, entrega_id, fecha, monto, moneda, forma, referencia").in("entrega_id", ids).order("fecha"),
    supabase
      .from("factura_recepcion")
      .select("id, entrega_id, pago_id, venta_id, estado, motivo, revisado_at, ventas(factura, fecha, monto, moneda, customers(nombre))")
      .in("entrega_id", ids),
    supabase.from("factura_entrega_notas").select("id, entrega_id, texto, autor_nombre, created_by, created_at").in("entrega_id", ids).order("created_at"),
  ]);
  type R = { id: string; entrega_id: string; pago_id: string; venta_id: string; estado: EstadoRecepcion; motivo: string | null; revisado_at: string | null; ventas: { factura: string | null; fecha: string; monto: string | null; moneda: string; customers: { nombre: string } | null } | null };
  const porPago = new Map<string, FacturaRec[]>();
  for (const r of (recs ?? []) as unknown as R[]) {
    const l = porPago.get(r.pago_id) ?? [];
    l.push({
      id: r.id, venta_id: r.venta_id, estado: r.estado, motivo: r.motivo, revisado_at: r.revisado_at,
      factura: r.ventas?.factura ?? null, cliente: r.ventas?.customers?.nombre ?? "Cliente", fecha_factura: (r.ventas?.fecha ?? "").slice(0, 10),
      monto: Number(r.ventas?.monto ?? 0), moneda: r.ventas?.moneda ?? "MXN",
    });
    porPago.set(r.pago_id, l);
  }
  type P = { id: string; entrega_id: string; fecha: string; monto: string; moneda: string; forma: FormaPago; referencia: string | null };
  const pagosPor = new Map<string, PagoRec[]>();
  for (const p of (pagos ?? []) as P[]) {
    const l = pagosPor.get(p.entrega_id) ?? [];
    l.push({ id: p.id, fecha: p.fecha, monto: Number(p.monto), moneda: p.moneda, forma: p.forma, referencia: p.referencia, facturas: (porPago.get(p.id) ?? []).sort((a, b) => (a.factura ?? "").localeCompare(b.factura ?? "")) });
    pagosPor.set(p.entrega_id, l);
  }
  const notasPor = new Map<string, NotaRec[]>();
  for (const n of (notas ?? []) as (NotaRec & { entrega_id: string })[]) {
    const l = notasPor.get(n.entrega_id) ?? [];
    l.push(n);
    notasPor.set(n.entrega_id, l);
  }
  return {
    entregas: (ents ?? []).map((e) => ({ ...(e as Omit<EntregaRec, "pagos" | "notasLista">), pagos: pagosPor.get(e.id as string) ?? [], notasLista: notasPor.get(e.id as string) ?? [] })),
    error: null,
  };
}

export const fechaCorta = (d: string) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "");
