"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { lineaSchema, ventaSchema, type VentaInput, type VentaLinea } from "@/lib/ventas";
import type { Result } from "./requests";

const uuid = z.string().uuid();
const refresh = (id?: string) => {
  revalidatePath("/vendedor/bitacora");
  if (id) revalidatePath(`/vendedor/bitacora/venta/${id}`);
};

/** Alta o edicion de una venta diaria con sus articulos. */
export async function saveVentaAction(id: string | null, input: VentaInput, lineas: VentaLinea[]): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (u.rol !== "vendedor") return { ok: false, error: "Las ventas las registran los vendedores." };
  const parsed = ventaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const ls = z.array(lineaSchema).max(50).safeParse(lineas.filter((l) => l.descripcion.trim()));
  if (!ls.success) return { ok: false, error: ls.error.issues[0].message };
  const visita = parsed.data.tipo === "visita";
  if (!visita && !id && !ls.data.length) return { ok: false, error: "Agrega el artículo principal de la venta (el de mayor costo)." };
  const supabase = await createClient();
  let ventaId = id;
  const fila: Record<string, unknown> = visita
    ? { ...parsed.data, monto: null, pedido: null, factura: null, pago: "contado" as const, dias_credito: null, entregado: false, porcentaje_cobrado: 0 }
    : { ...parsed.data, motivo_no_venta: null };
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Venta inválida" };
    const { tipo: _tipo, ...upd } = fila;
    void _tipo;
    const { data, error } = await supabase.from("ventas").update(upd).eq("id", id).select("id");
    if (error) return { ok: false, error: friendlyError(error.message) };
    if (!data?.length) return { ok: false, error: "Ya no puedes editar esta venta." };
  } else {
    const { data, error } = await supabase.from("ventas").insert(fila).select("id").single();
    if (error) return { ok: false, error: friendlyError(error.message) };
    ventaId = data.id;
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
  refresh(ventaId!);
  revalidatePath("/vendedor/bitacora/venta");
  return { ok: true, id: ventaId! };
}

/** Marcar rapido desde la lista: entregada o cobrada. */
export async function quickVentaAction(id: string, patch: { entregado?: boolean; porcentaje_cobrado?: number }): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Venta inválida" };
  const p: Record<string, unknown> = {};
  if (typeof patch.entregado === "boolean") p.entregado = patch.entregado;
  if (typeof patch.porcentaje_cobrado === "number" && patch.porcentaje_cobrado >= 0 && patch.porcentaje_cobrado <= 100) p.porcentaje_cobrado = patch.porcentaje_cobrado;
  const supabase = await createClient();
  const { data, error } = await supabase.from("ventas").update(p).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
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
