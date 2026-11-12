"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { CATALOGO } from "@/lib/marca";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const sinTablas = (m: string) => (/catalogo_/.test(m) ? "Primero corre la actualización 0053 en Supabase." : friendlyError(m));

/** Ya vio el aviso del catalogo nuevo: no se le vuelve a abrir solo. */
export async function catalogoVistoAction(): Promise<Result> {
  const u = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("catalogo_vistos").insert({ user_id: u.id, version: CATALOGO.version });
  if (error && error.code !== "23505") return { ok: false, error: sinTablas(error.message) };
  return { ok: true };
}

const textoSchema = z.string().trim().min(3, "Escribe tu comentario (mínimo 3 letras).").max(2000, "El comentario es muy largo (máximo 2000 letras).");

/** Comentario o sugerencia del catalogo: le llega a compras. */
export async function comentarCatalogoAction(texto: string): Promise<Result> {
  await requireUser();
  const t = textoSchema.safeParse(texto);
  if (!t.success) return { ok: false, error: t.error.issues[0]?.message ?? "Comentario inválido" };
  const supabase = await createClient();
  const { error } = await supabase.from("catalogo_comentarios").insert({ version: CATALOGO.version, texto: t.data });
  if (error) return { ok: false, error: sinTablas(error.message) };
  revalidatePath("/comprador/catalogo");
  return { ok: true };
}

/** El comprador marca (o desmarca) un comentario como revisado. */
export async function revisarComentarioCatalogoAction(id: string, revisado: boolean): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "comprador") return { ok: false, error: "Solo compras puede marcar los comentarios." };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Comentario inválido" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("catalogo_comentarios").update({ revisado_at: revisado ? new Date().toISOString() : null }).eq("id", id).select("id");
  if (error) return { ok: false, error: sinTablas(error.message) };
  if (!data?.length) return { ok: false, error: "No se pudo marcar el comentario." };
  revalidatePath("/comprador/catalogo");
  return { ok: true };
}
