"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { SUPPLIER_COLS, supplierSchema, type SupplierInput, type SupplierRow } from "@/lib/evaluaciones";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();

export async function saveSupplierAction(id: string | null, input: SupplierInput): Promise<Result<{ supplier: SupplierRow }>> {
  const u = await requireUser();
  if (u.rol !== "comprador") return { ok: false, error: "Solo el comprador da de alta proveedores." };
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const q = id
    ? supabase.from("suppliers").update(parsed.data).eq("id", id).select(SUPPLIER_COLS).single()
    : supabase.from("suppliers").insert(parsed.data).select(SUPPLIER_COLS).single();
  const { data, error } = await q;
  if (error) return { ok: false, error: /duplicate/i.test(error.message) ? "Ya existe un proveedor con ese nombre." : friendlyError(error.message) };
  revalidatePath("/comprador/proveedores");
  revalidatePath("/evaluaciones/proveedores");
  return { ok: true, supplier: data as SupplierRow };
}

export async function setSupplierFlagsAction(id: string, flags: { activo?: boolean; evaluar?: boolean }): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "comprador") return { ok: false, error: "No autorizado" };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Proveedor inválido" };
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update(flags).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/comprador/proveedores");
  revalidatePath("/evaluaciones/proveedores");
  return { ok: true };
}

export async function activarEvaluacionAction(tipo: "proveedores" | "clientes"): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("eval_activar", { p_tipo: tipo });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath(`/evaluaciones/${tipo}`);
  return { ok: true };
}

export async function cerrarEvaluacionAction(tipo: "proveedores" | "clientes"): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("eval_cerrar", { p_tipo: tipo });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath(`/evaluaciones/${tipo}`);
  return { ok: true };
}

export async function guardarEvalProveedorAction(id: string, resp: Record<string, number>, comentario: string): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Evaluación inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("eval_proveedor_guardar", { p_id: id, p_resp: resp, p_comentario: comentario.trim() || null });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/evaluaciones/proveedores");
  revalidatePath(`/evaluaciones/proveedores/${id}`);
  return { ok: true };
}

export async function generarEncuestaAction(customerId: string): Promise<Result<{ id: string; token: string }>> {
  await requireUser();
  if (!uuid.safeParse(customerId).success) return { ok: false, error: "Cliente inválido" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("encuesta_generar", { p_customer: customerId });
  if (error) return { ok: false, error: friendlyError(error.message) };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; token: string };
  revalidatePath("/evaluaciones/clientes");
  return { ok: true, id: row.id, token: row.token };
}

export async function marcarEncuestaEnviadaAction(id: string, medio: "whatsapp" | "correo" | "otro"): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Encuesta inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("encuesta_marcar_enviada", { p_id: id, p_medio: medio });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/evaluaciones/clientes");
  return { ok: true };
}

/** Publico: el cliente responde con su link (sin sesion). */
export async function responderEncuestaAction(token: string, resp: Record<string, number>, comentario: string, nombre: string): Promise<Result> {
  if (!/^[0-9a-f]{32,64}$/.test(token)) return { ok: false, error: "Link inválido" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("encuesta_responder", { p_token: token, p_resp: resp, p_comentario: comentario.trim() || null, p_nombre: nombre.trim() || null });
  if (error) return { ok: false, error: error.message || "No se pudo guardar" };
  return { ok: true };
}
