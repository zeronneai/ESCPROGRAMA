"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const conf = z.object({
  meta_telemarketing: z.number().int().min(0).max(200),
  meta_campo: z.number().int().min(0).max(200),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de inicio inválida"),
});

/** La jefa de ventas cambia las metas diarias y la fecha desde la que se cuentan. */
export async function guardarMetaProspeccionAction(input: z.input<typeof conf>): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "jefe_ventas") return { ok: false, error: "Solo la jefa de ventas cambia la meta." };
  const p = conf.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("prospeccion_config").upsert({ id: 1, ...p.data, updated_by: u.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/ventas/meta-prospeccion");
  return { ok: true };
}

/** La jefa de ventas dice si un vendedor es de telemarketing, de campo o sin meta. */
export async function tipoProspeccionAction(vendedorId: string, tipo: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "jefe_ventas") return { ok: false, error: "Solo la jefa de ventas cambia el tipo." };
  if (!z.string().uuid().safeParse(vendedorId).success || !["telemarketing", "campo", "sin_meta"].includes(tipo)) return { ok: false, error: "Dato inválido" };
  const supabase = await createClient();
  const { error } = await supabase.from("prospeccion_vendedor").upsert({ vendedor_id: vendedorId, tipo, updated_by: u.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/ventas/meta-prospeccion");
  return { ok: true };
}

const metaVenta = z.object({
  id: z.string().uuid().nullable(),
  nombre: z.string().trim().min(1, "Pon el nombre.").max(120),
  vendedor_id: z.string().uuid().nullable(),
  capturista_id: z.string().uuid().nullable().optional(),
  alias_factura: z.string().trim().max(150).nullable().optional(),
  meta: z.number({ error: "Pon la meta." }).positive("La meta debe ser mayor a 0.").max(1e10),
  estado: z.enum(["activa", "pausada"]),
});

/** La jefa de ventas crea o cambia una meta mensual de venta. */
export async function guardarMetaVentaAction(input: z.input<typeof metaVenta>): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "jefe_ventas") return { ok: false, error: "Solo la jefa de ventas cambia las metas." };
  const p = metaVenta.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const { id, ...datos } = p.data;
  const fila = { ...datos, updated_by: u.id, updated_at: new Date().toISOString() };
  const { error } = id ? await supabase.from("metas_venta").update(fila).eq("id", id) : await supabase.from("metas_venta").insert(fila);
  if (error) return { ok: false, error: /metas_venta_vendedor_id_key|duplicate/.test(error.message) ? "Ese usuario ya tiene una meta." : friendlyError(error.message) };
  revalidatePath("/ventas/meta-prospeccion");
  revalidatePath("/metas");
  return { ok: true };
}

export async function borrarMetaVentaAction(id: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "jefe_ventas") return { ok: false, error: "Solo la jefa de ventas." };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Meta inválida" };
  const supabase = await createClient();
  const { error } = await supabase.from("metas_venta").delete().eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/ventas/meta-prospeccion");
  revalidatePath("/metas");
  return { ok: true };
}

const captura = z.object({
  meta_id: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  folio: z.string().trim().max(60).nullable().optional(),
  cliente: z.string().trim().max(200).nullable().optional(),
  subtotal: z.number({ error: "Pon el importe sin IVA." }).positive("El importe debe ser mayor a 0.").max(1e10),
  moneda: z.enum(["MXN", "USD"]),
  tipo_cambio: z.number().min(5, "Revisa el tipo de cambio").max(60, "Revisa el tipo de cambio").nullable().optional(),
  nota: z.string().trim().max(500).nullable().optional(),
});

/** Capturar a mano una venta (sin IVA) para una meta sin usuario, como la de Jose Ortiz. */
export async function capturarVentaMetaAction(input: z.input<typeof captura>): Promise<Result> {
  await requireUser();
  const p = captura.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const d = p.data;
  const { error } = await supabase.from("metas_venta_capturas").insert({
    ...d, folio: d.folio || null, cliente: d.cliente || null, nota: d.nota || null, tipo_cambio: d.moneda === "USD" ? (d.tipo_cambio ?? null) : null,
  });
  if (error) return { ok: false, error: /row-level/.test(error.message) ? "No tienes permiso para capturar ventas de esta meta." : friendlyError(error.message) };
  revalidatePath("/captura-ventas");
  revalidatePath("/metas");
  revalidatePath("/periodo-metas");
  return { ok: true };
}

export async function cancelarCapturaAction(id: string): Promise<Result> {
  await requireUser();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Captura inválida" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("metas_venta_capturas").update({ cancelada_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "No se pudo cancelar." };
  revalidatePath("/captura-ventas");
  revalidatePath("/metas");
  return { ok: true };
}

const periodo = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

/** La jefa elige desde/hasta que dia cuenta el mes (la meta se ajusta en proporcion). */
export async function guardarPeriodoMetasAction(input: z.input<typeof periodo>): Promise<Result> {
  const u = await requireUser();
  if (!["jefe_ventas", "comprador", "marketplaces"].includes(u.rol)) return { ok: false, error: "Solo la jefa de ventas, el comprador o marketplaces." };
  const p = periodo.safeParse(input);
  if (!p.success) return { ok: false, error: "Fechas inválidas" };
  if (p.data.desde && p.data.hasta && p.data.hasta < p.data.desde) return { ok: false, error: "La fecha final va después de la inicial." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("metas_config").update({ ...p.data, updated_by: u.id, updated_at: new Date().toISOString() }).eq("id", 1).select("id");
  if (error) return { ok: false, error: /metas_config/.test(error.message) ? "Falta correr la actualización 0081 en la base." : friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: u.rol === "comprador" ? "Falta correr la actualización 0083 en la base." : u.rol === "marketplaces" ? "Falta correr la actualización 0084 en la base." : "No se pudo guardar." };
  revalidatePath("/ventas/meta-prospeccion");
  revalidatePath("/metas");
  return { ok: true };
}
