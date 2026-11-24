"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const falta = (m: string) => /conciliacion_|conciliaciones|does not exist/.test(m);
const msg = (m: string) => (falta(m) ? "Falta correr la actualización 0076 en la base." : /COMISION_FALTA/.test(m) ? "Antes de marcarla pagada, pon la comisión de cada artículo." : friendlyError(m.replace(/^FECHA_PAGO_MAL:\s*/, "")));

function revalidar() {
  revalidatePath("/finanzas/conciliaciones", "layout");
  revalidatePath("/vendedor/conciliaciones");
  revalidatePath("/vendedor/bitacora");
  revalidatePath("/vendedor/recepcion-facturas");
}

const abono = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descripcion: z.string().max(500),
  referencia: z.string().max(80).nullable().optional(),
  monto: z.number().positive().max(999_999_999),
});
const estadoSchema = z.object({
  banco: z.string().min(1).max(40),
  cuenta: z.string().max(30).nullable(),
  moneda: z.enum(["MXN", "USD"]),
  desde: z.string().nullable(),
  hasta: z.string().nullable(),
  abonos: z.array(abono).min(1, "El estado de cuenta no trae abonos").max(5000),
});

/** Finanzas sube el estado de cuenta: el PDF (se guarda) y los abonos que ya se leyeron en el navegador. */
export async function subirConciliacionAction(fd: FormData): Promise<Result<{ id: string; nuevos: number; repetidos: number }>> {
  await requireUser();
  let datos: unknown;
  try {
    datos = JSON.parse(String(fd.get("datos") ?? ""));
  } catch {
    return { ok: false, error: "Datos inválidos" };
  }
  const p = estadoSchema.safeParse(datos);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
  const supabase = await createClient();
  let archivo_path: string | null = null;
  let nombre_archivo: string | null = null;
  const f = fd.get("pdf");
  if (f instanceof File && f.size > 0) {
    if (f.size > 15 * 1024 * 1024) return { ok: false, error: "El PDF pesa más de 15 MB" };
    archivo_path = `${new Date().getFullYear()}/${randomUUID()}.pdf`;
    nombre_archivo = f.name.slice(0, 200);
    const { error } = await supabase.storage.from("conciliaciones").upload(archivo_path, f, { contentType: "application/pdf" });
    if (error) return { ok: false, error: /bucket/i.test(error.message) ? "Falta correr la actualización 0076 en la base." : friendlyError(error.message) };
  }
  const { data, error } = await supabase.rpc("conciliacion_subir", { p: { ...p.data, archivo_path, nombre_archivo } });
  if (error) return { ok: false, error: msg(error.message) };
  revalidar();
  const r = data as { id: string; nuevos: number; repetidos: number };
  return { ok: true, ...r };
}

export interface FacturaBuscada {
  folio: string;
  venta_id: string | null;
  cliente: string | null;
  monto: number | null;
  moneda: string | null;
  fecha: string | null;
  pagada: boolean;
  lineas: { id: string; clave: string | null; descripcion: string; cantidad: number | null; importe: number | null; envio: number | null; comision_pct: number | null }[];
}

/** El vendedor escribe folios: se buscan en SUS ventas (para saber si ya la subio y si le falta comision). */
export async function buscarFacturasAction(folios: string[]): Promise<Result<{ facturas: FacturaBuscada[] }>> {
  const u = await requireUser();
  const lista = [...new Set(folios.map((f) => f.trim().toUpperCase()).filter(Boolean))].slice(0, 30);
  if (!lista.length) return { ok: true, facturas: [] };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ventas")
    .select("id, factura, fecha, monto, moneda, porcentaje_cobrado, created_at, customers(nombre)")
    .eq("vendedor_id", u.id)
    .eq("tipo", "venta")
    .is("cancelada_at", null)
    .not("factura", "is", null)
    .order("created_at", { ascending: false })
    .limit(3000);
  if (error) return { ok: false, error: friendlyError(error.message) };
  type V = { id: string; factura: string; fecha: string; monto: string | null; moneda: string; porcentaje_cobrado: string; customers: { nombre: string } | null };
  const porFolio = new Map<string, V>();
  for (const v of (data ?? []) as unknown as V[]) {
    const k = v.factura.trim().toUpperCase();
    if (!porFolio.has(k)) porFolio.set(k, v);
  }
  const ids = lista.map((f) => porFolio.get(f)?.id).filter(Boolean) as string[];
  const lineas = new Map<string, FacturaBuscada["lineas"]>();
  if (ids.length) {
    const traer = (cols: string) => supabase.from("venta_lineas").select(cols).in("venta_id", ids).order("created_at");
    let r = await traer("id, venta_id, descripcion, cantidad, importe, envio, comision_pct, created_at, articulos(clave)");
    if (r.error) r = await traer("id, venta_id, descripcion, cantidad, importe, comision_pct, created_at, articulos(clave)");
    type L = { id: string; venta_id: string; descripcion: string; cantidad: string | null; importe: string | null; envio?: string | null; comision_pct: string | null; articulos: { clave: string } | null };
    for (const l of (r.data ?? []) as unknown as L[]) {
      const x = lineas.get(l.venta_id) ?? [];
      x.push({ id: l.id, clave: l.articulos?.clave ?? null, descripcion: l.descripcion, cantidad: l.cantidad == null ? null : Number(l.cantidad), importe: l.importe == null ? null : Number(l.importe), envio: l.envio == null ? null : Number(l.envio), comision_pct: l.comision_pct == null ? null : Number(l.comision_pct) });
      lineas.set(l.venta_id, x);
    }
  }
  return {
    ok: true,
    facturas: lista.map((folio) => {
      const v = porFolio.get(folio);
      return v
        ? { folio, venta_id: v.id, cliente: v.customers?.nombre ?? null, monto: v.monto == null ? null : Number(v.monto), moneda: v.moneda, fecha: v.fecha.slice(0, 10), pagada: Number(v.porcentaje_cobrado) >= 100, lineas: lineas.get(v.id) ?? [] }
        : { folio, venta_id: null, cliente: null, monto: null, moneda: null, fecha: null, pagada: false, lineas: [] };
    }),
  };
}

/** El vendedor toma un abono con la(s) factura(s) que paga. */
export async function tomarPagoAction(movId: string, folios: string[]): Promise<Result<{ resultado: { folio: string; estado: string }[] }>> {
  await requireUser();
  if (!z.string().uuid().safeParse(movId).success) return { ok: false, error: "Pago inválido" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("conciliacion_tomar", { p_mov: movId, p_folios: folios.map((f) => f.trim()).filter(Boolean).slice(0, 30) });
  if (error) return { ok: false, error: msg(error.message) };
  revalidar();
  return { ok: true, resultado: (data ?? []) as { folio: string; estado: string }[] };
}

/** Soltar un abono tomado. */
export async function soltarPagoAction(movId: string): Promise<Result> {
  await requireUser();
  if (!z.string().uuid().safeParse(movId).success) return { ok: false, error: "Pago inválido" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("conciliacion_soltar", { p_mov: movId });
  if (error) return { ok: false, error: msg(error.message) };
  revalidar();
  return { ok: true };
}

/** Marcar pagada una factura ligada a un abono (cuando ya tiene su comision). */
export async function marcarPagadaConciliacionAction(filaId: string): Promise<Result> {
  await requireUser();
  if (!z.string().uuid().safeParse(filaId).success) return { ok: false, error: "Factura inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("conciliacion_marcar_pagada", { p_fila: filaId });
  if (error) return { ok: false, error: msg(error.message) };
  revalidar();
  return { ok: true };
}
