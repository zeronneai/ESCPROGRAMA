"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { analisisSchema, RIESGO_ROLES, type Actividad } from "@/lib/riesgos";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();

/** Jefe de area: empezar un analisis de riesgo de su proceso. */
export async function crearAnalisisAction(input: { proceso: string; fecha: string; actividades: Actividad[] }): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (!RIESGO_ROLES.includes(u.rol)) return { ok: false, error: "Tu puesto no hace análisis de riesgo." };
  const p = analisisSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("riesgo_analisis").insert(p.data).select("id").single();
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/calidad/riesgos");
  return { ok: true, id: data.id };
}

/** Guardar los cambios del analisis (proceso, fecha y todas sus actividades y modos de falla). */
export async function guardarAnalisisAction(id: string, input: { proceso: string; fecha: string; actividades: Actividad[] }): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Análisis inválido" };
  const p = analisisSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("riesgo_analisis").update(p.data).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "No tienes permiso para editar este análisis." };
  revalidatePath("/calidad/riesgos");
  revalidatePath(`/calidad/riesgos/${id}`);
  return { ok: true };
}
