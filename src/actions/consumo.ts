"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { consumoSchema, type ConsumoInput } from "@/lib/ops/consumo";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();
const refresh = (id?: string) => {
  revalidatePath("/consumo");
  if (id) revalidatePath(`/consumo/${id}`);
};

export async function saveConsumoAction(id: string | null, input: ConsumoInput): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (u.rol === "comprador") return { ok: false, error: "El comprador no levanta solicitudes de consumo interno." };
  const parsed = consumoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Solicitud inválida" };
    const { data, error } = await supabase.from("consumo_solicitudes").update(parsed.data).eq("id", id).select("id");
    if (error) return { ok: false, error: friendlyError(error.message) };
    if (!data?.length) return { ok: false, error: "Solo puedes editarla mientras está por aprobar." };
    refresh(id);
    return { ok: true, id };
  }
  const { data, error } = await supabase.from("consumo_solicitudes").insert(parsed.data).select("id").single();
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh();
  return { ok: true, id: data.id };
}

export async function aprobarConsumoAction(id: string, aprobar: boolean, nota: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "jefe_ventas") return { ok: false, error: "Solo la jefa de ventas aprueba." };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Solicitud inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("consumo_aprobar", { p_id: id, p_aprobar: aprobar, p_nota: nota.trim() || null });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

export async function avanceConsumoAction(id: string, estado: "en_proceso" | "completada", fecha: string, nota: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "comprador") return { ok: false, error: "Solo el comprador marca el avance." };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Solicitud inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("consumo_avance", {
    p_id: id,
    p_estado: estado,
    p_fecha: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null,
    p_nota: nota.trim() || null,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

export async function cancelarConsumoAction(id: string, nota: string): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Solicitud inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("consumo_cancelar", { p_id: id, p_nota: nota.trim() || null });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

export async function commentConsumoAction(id: string, nota: string): Promise<Result> {
  await requireUser();
  const n = z.string().trim().min(2, "Escribe el comentario").max(1000).safeParse(nota);
  if (!n.success) return { ok: false, error: n.error.issues[0].message };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Solicitud inválida" };
  const supabase = await createClient();
  const { error } = await supabase.from("consumo_eventos").insert({ solicitud_id: id, tipo: "comentario", nota: n.data });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}
