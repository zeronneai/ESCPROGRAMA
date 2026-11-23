"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { errorCobro, lineaSchema, ventaSchema, type VentaInput, type VentaLinea } from "@/lib/ventas";
import type { Result } from "./requests";

const uuid = z.string().uuid();
const refresh = (id?: string) => {
  revalidatePath("/vendedor/bitacora");
  if (id) revalidatePath(`/vendedor/bitacora/venta/${id}`);
};

/** Alta o edicion de una venta diaria con sus articulos. */
export async function saveVentaAction(id: string | null, input: VentaInput, lineas: VentaLinea[]): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (u.rol !== "vendedor" && u.rol !== "jefe_ventas") return { ok: false, error: "Las ventas las registran los vendedores." };
  const parsed = ventaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const ls = z.array(lineaSchema).max(50).safeParse(lineas.filter((l) => l.descripcion.trim()));
  if (!ls.success) return { ok: false, error: ls.error.issues[0].message };
  const visita = parsed.data.tipo === "visita";
  if (!visita && !id && !ls.data.length) return { ok: false, error: "Agrega el artículo principal de la venta (el de mayor costo)." };
  const supabase = await createClient();
  let ventaId = id;
  let cobroPendiente = 0;
  let fechaCobro: string | null = null;
  const fila: Record<string, unknown> = visita
    ? { ...parsed.data, monto: null, pedido: null, factura: null, pago: "contado" as const, dias_credito: null, entregado: false, porcentaje_cobrado: 0 }
    : { ...parsed.data, motivo_no_venta: null };
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Venta inválida" };
    const { tipo: _tipo, ...upd } = fila;
    void _tipo;
    const { data, error } = await supabase.from("ventas").update(upd).eq("id", id).select("id");
    if (error) return { ok: false, error: errorCobro(error.message) ?? friendlyError(error.message) };
    if (!data?.length) return { ok: false, error: "Ya no puedes editar esta venta." };
  } else {
    // Se registra sin cobro y, ya con sus articulos, se marca lo cobrado (para revisar la comision al pagarla).
    const cobro = Number(fila.porcentaje_cobrado ?? 0);
    fechaCobro = (fila.fecha_cobro as string | null) ?? null;
    const { data, error } = await supabase.from("ventas").insert({ ...fila, porcentaje_cobrado: 0, fecha_cobro: null }).select("id").single();
    if (error) return { ok: false, error: friendlyError(error.message) };
    ventaId = data.id;
    cobroPendiente = cobro;
  }
  if (visita) {
    refresh(ventaId!);
    return { ok: true, id: ventaId! };
  }
  // Lineas: se quitan las que ya no estan, se actualizan y se agregan las nuevas.
  const { data: prev } = await supabase.from("venta_lineas").select("id").eq("venta_id", ventaId!);
  const keep = new Set(ls.data.filter((l) => l.id).map((l) => l.id));
  const drop = (prev ?? []).filter((p) => !keep.has(p.id)).map((p) => p.id);
  if (drop.length) await supabase.from("venta_lineas").delete().in("id", drop);
  for (const l of ls.data.filter((x) => x.id)) {
    await supabase.from("venta_lineas").update({ cantidad: l.cantidad, descripcion: l.descripcion }).eq("id", l.id!);
  }
  const nuevas = ls.data.filter((l) => !l.id).map((l) => ({ venta_id: ventaId, articulo_id: l.articulo_id, descripcion: l.descripcion, cantidad: l.cantidad }));
  if (nuevas.length) {
    const { error } = await supabase.from("venta_lineas").insert(nuevas);
    if (error) return { ok: false, error: friendlyError(error.message) };
  }
  if (cobroPendiente > 0) {
    const { error } = await supabase.from("ventas").update({ porcentaje_cobrado: cobroPendiente, fecha_cobro: cobroPendiente >= 100 ? fechaCobro : null }).eq("id", ventaId!);
    if (error) {
      refresh(ventaId!);
      return { ok: false, error: `La venta se registró, pero no como pagada. ${errorCobro(error.message) ?? friendlyError(error.message)}` };
    }
  }
  refresh(ventaId!);
  revalidatePath("/vendedor/bitacora/venta");
  return { ok: true, id: ventaId! };
}

/** Marcar rapido desde la lista: entregada o cobrada. */
export async function quickVentaAction(id: string, patch: { entregado?: boolean; porcentaje_cobrado?: number; fecha_cobro?: string }): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Venta inválida" };
  const p: Record<string, unknown> = {};
  if (typeof patch.entregado === "boolean") p.entregado = patch.entregado;
  if (typeof patch.porcentaje_cobrado === "number" && patch.porcentaje_cobrado >= 0 && patch.porcentaje_cobrado <= 100) p.porcentaje_cobrado = patch.porcentaje_cobrado;
  if (p.porcentaje_cobrado === 100) {
    if (!patch.fecha_cobro || !/^\d{4}-\d{2}-\d{2}$/.test(patch.fecha_cobro)) return { ok: false, error: "Escribe la fecha en que te pagaron." };
    p.fecha_cobro = patch.fecha_cobro;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("ventas").update(p).eq("id", id).select("id");
  if (error) return { ok: false, error: errorCobro(error.message) ?? friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "No tienes permiso para editar esta venta." };
  refresh(id);
  return { ok: true };
}

export async function cancelarVentaAction(id: string): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Venta inválida" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("ventas").update({ cancelada_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "No tienes permiso para cancelar esta venta." };
  refresh(id);
  return { ok: true };
}

const comisionSchema = z.array(
  z.object({
    id: z.string().uuid(),
    importe: z.union([z.null(), z.coerce.number().min(0, "Importe inválido").max(999_999_999)]),
    comision_pct: z.union([z.null(), z.coerce.number().min(0, "El % va de 0 a 100").max(100, "El % va de 0 a 100")]),
  }),
).max(200);

/** Importe y % de comision de cada articulo de una venta (vendedor antes de pagarla; la jefa siempre). */
export async function comisionesVentaAction(ventaId: string, lineas: unknown): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(ventaId).success) return { ok: false, error: "Venta inválida" };
  const p = comisionSchema.safeParse(lineas);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("venta_comisiones", { p_venta: ventaId, p_lineas: p.data });
  if (error) return { ok: false, error: /venta_comisiones|comision_pct/.test(error.message) ? "Falta correr la actualización 0072 en la base." : friendlyError(error.message) };
  refresh(ventaId);
  revalidatePath("/ventas/comisiones");
  return { ok: true };
}

/** Jefa de ventas: marca (o quita) la revision de la comision de una venta. */
export async function revisarComisionAction(ventaId: string, revisada: boolean): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(ventaId).success) return { ok: false, error: "Venta inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("venta_comision_revisar", { p_venta: ventaId, p_revisada: revisada });
  if (error) return { ok: false, error: /venta_comision_revisar/.test(error.message) ? "Falta correr la actualización 0074 en la base." : friendlyError(error.message) };
  revalidatePath("/ventas/comisiones");
  revalidatePath("/vendedor/comisiones");
  return { ok: true };
}

export interface VentaSinImporte {
  id: string;
  factura: string | null;
  pdf: boolean;
  xml: boolean;
  lineas: { id: string; clave: string | null; descripcion: string; cantidad: number | null; comision_pct: number | null }[];
}

/** Jefa: ventas subidas con factura a las que les falta el importe de algun articulo (para volver a leerlas). */
export async function ventasSinImporteAction(): Promise<Result<{ ventas: VentaSinImporte[] }>> {
  const u = await requireUser();
  if (u.rol !== "jefe_ventas") return { ok: false, error: "Solo la jefa de ventas." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venta_lineas")
    .select("venta_id, ventas!inner(id, factura, factura_path, xml_path, origen, cancelada_at)")
    .is("importe", null)
    .eq("ventas.origen", "factura")
    .is("ventas.cancelada_at", null)
    .limit(5000);
  if (error) return { ok: false, error: /importe/.test(error.message) ? "Falta correr la actualización 0072 en la base." : friendlyError(error.message) };
  type R = { venta_id: string; ventas: { id: string; factura: string | null; factura_path: string | null; xml_path: string | null } };
  const ids = [...new Set(((data ?? []) as unknown as R[]).filter((r) => r.ventas.factura_path || r.ventas.xml_path).map((r) => r.venta_id))];
  const info = new Map(((data ?? []) as unknown as R[]).map((r) => [r.venta_id, r.ventas]));
  const ventas: VentaSinImporte[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: ls } = await supabase.from("venta_lineas").select("id, venta_id, descripcion, cantidad, comision_pct, created_at, articulos(clave)").in("venta_id", ids.slice(i, i + 200)).order("created_at");
    type L = { id: string; venta_id: string; descripcion: string; cantidad: string | null; comision_pct: string | null; articulos: { clave: string } | null };
    const por = new Map<string, VentaSinImporte["lineas"]>();
    for (const l of (ls ?? []) as unknown as L[]) {
      const x = por.get(l.venta_id) ?? [];
      x.push({ id: l.id, clave: l.articulos?.clave ?? null, descripcion: l.descripcion, cantidad: l.cantidad == null ? null : Number(l.cantidad), comision_pct: l.comision_pct == null ? null : Number(l.comision_pct) });
      por.set(l.venta_id, x);
    }
    for (const id of ids.slice(i, i + 200)) {
      const v = info.get(id)!;
      ventas.push({ id, factura: v.factura, pdf: !!v.factura_path, xml: !!v.xml_path, lineas: por.get(id) ?? [] });
    }
  }
  return { ok: true, ventas };
}

/** Jefa: guarda los importes leidos de la factura (sin tocar el % de comision). */
export async function guardarImportesAction(ventaId: string, importes: { id: string; importe: number; comision_pct: number | null }[]): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "jefe_ventas") return { ok: false, error: "Solo la jefa de ventas." };
  return comisionesVentaAction(ventaId, importes);
}
