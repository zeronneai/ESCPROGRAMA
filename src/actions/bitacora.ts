"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { bitacoraSchema, type BitacoraInput } from "@/lib/validation/bitacora";
import type { Result } from "./requests";

async function requireSeller() {
  const u = await requireUser();
  if (u.rol !== "vendedor") throw new Error("No autorizado");
  return u;
}
const uuid = z.string().uuid();
const refresh = (id?: string) => {
  revalidatePath("/vendedor/bitacora");
  if (id) revalidatePath(`/vendedor/bitacora/${id}`);
};

export async function createBitacoraAction(customerId: string, input: BitacoraInput): Promise<Result<{ id: string }>> {
  const u = await requireSeller();
  if (!uuid.safeParse(customerId).success) return { ok: false, error: "Elige el cliente o prospecto" };
  const parsed = bitacoraSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bitacora")
    .insert({ ...parsed.data, customer_id: customerId, vendedor_id: u.id, created_by: u.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh();
  return { ok: true, id: data.id };
}

export async function updateBitacoraAction(id: string, input: BitacoraInput): Promise<Result> {
  const u = await requireSeller();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Registro inválido" };
  const parsed = bitacoraSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("bitacora").update({ ...parsed.data, vendedor_id: u.id }).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "No tienes permiso para editar este registro." };
  refresh(id);
  return { ok: true };
}

export async function addBitacoraCommentAction(id: string, nota: string): Promise<Result> {
  const u = await requireSeller();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Registro inválido" };
  const n = z.string().trim().min(2, "Escribe el comentario").max(2000).safeParse(nota);
  if (!n.success) return { ok: false, error: n.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("bitacora_eventos").insert({ bitacora_id: id, tipo: "comentario", nota: n.data, created_by: u.id });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

/** Un registro sin vendedor (sitio web) pasa a ser de quien lo toma. */
export async function claimBitacoraAction(id: string): Promise<Result> {
  const u = await requireSeller();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Registro inválido" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("bitacora").update({ vendedor_id: u.id }).eq("id", id).is("vendedor_id", null).select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "Otro vendedor ya lo tomó." };
  refresh(id);
  return { ok: true };
}

export async function archiveBitacoraAction(id: string, archive: boolean): Promise<Result> {
  const u = await requireSeller();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Registro inválido" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bitacora")
    .update({ archived_at: archive ? new Date().toISOString() : null, vendedor_id: u.id })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "No tienes permiso para editar este registro." };
  refresh(id);
  return { ok: true };
}
