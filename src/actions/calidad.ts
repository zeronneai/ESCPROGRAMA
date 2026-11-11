"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { CALIDAD_FILE_TYPES, MAX_FILE_BYTES, QUEJA_ESTADOS_MANUALES, quejaSchema, sacSchema, type QuejaEstado, type QuejaInput, type SacInput } from "@/lib/ops/calidad";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();
const refresh = (path?: string) => {
  revalidatePath("/calidad");
  if (path) revalidatePath(path);
};

export async function saveQuejaAction(id: string | null, input: QuejaInput): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (u.rol !== "vendedor" && u.rol !== "coordinador_iso") return { ok: false, error: "Solo vendedores o el coordinador ISO capturan quejas." };
  const parsed = quejaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = { ...parsed.data, vendedor_id: u.rol === "coordinador_iso" ? parsed.data.vendedor_id : undefined };
  const supabase = await createClient();
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Queja inválida" };
    const { data, error } = await supabase.from("quejas").update(v).eq("id", id).select("id");
    if (error) return { ok: false, error: friendlyError(error.message) };
    if (!data?.length) return { ok: false, error: "Ya no puedes editar esta queja (solo mientras está abierta)." };
    refresh(`/calidad/quejas/${id}`);
    return { ok: true, id };
  }
  const { data, error } = await supabase.from("quejas").insert(v).select("id").single();
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh();
  return { ok: true, id: data.id };
}

/** El coordinador ISO decide si la queja aplica. Si aplica se desbloquea todo; si no, queda el motivo. */
export async function quejaDictamenAction(id: string, aplica: boolean, nota: string, vendedorId: string | null): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "coordinador_iso") return { ok: false, error: "Solo el coordinador ISO decide si la queja aplica." };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Queja inválida" };
  if (vendedorId && !uuid.safeParse(vendedorId).success) return { ok: false, error: "Vendedor inválido" };
  if (!aplica && nota.trim().length < 3) return { ok: false, error: "Escribe por qué no aplica." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("queja_dictaminar", { p_id: id, p_aplica: aplica, p_nota: nota.trim().slice(0, 2000) || null, p_vendedor: vendedorId || null });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(`/calidad/quejas/${id}`);
  return { ok: true };
}

export async function quejaEstadoAction(id: string, estado: QuejaEstado, solucion: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "coordinador_iso") return { ok: false, error: "Solo el coordinador ISO cambia el estatus." };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Queja inválida" };
  if (!(QUEJA_ESTADOS_MANUALES as readonly string[]).includes(estado)) return { ok: false, error: "Usa el botón Sí aplica / No aplica." };
  if (estado === "cerrada" && solucion.trim().length < 3) return { ok: false, error: "Para cerrar escribe la solución o respuesta al cliente." };
  const supabase = await createClient();
  const { error } = await supabase.from("quejas").update({ estado, solucion: solucion.trim().slice(0, 4000) || null }).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(`/calidad/quejas/${id}`);
  return { ok: true };
}

export async function saveSacAction(id: string | null, input: SacInput): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (u.rol !== "coordinador_iso") return { ok: false, error: "Solo el coordinador ISO llena la acción correctiva." };
  const parsed = sacSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Acción inválida" };
    const { error } = await supabase.from("acciones_correctivas").update(parsed.data).eq("id", id);
    if (error) return { ok: false, error: friendlyError(error.message) };
    refresh(`/calidad/sac/${id}`);
    return { ok: true, id };
  }
  const { data, error } = await supabase.from("acciones_correctivas").insert(parsed.data).select("id").single();
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(parsed.data.queja_id ? `/calidad/quejas/${parsed.data.queja_id}` : undefined);
  return { ok: true, id: data.id };
}

export async function addCalidadCommentAction(ref: { queja_id?: string; sac_id?: string }, nota: string): Promise<Result> {
  await requireUser();
  const n = z.string().trim().min(2, "Escribe el comentario").max(2000).safeParse(nota);
  if (!n.success) return { ok: false, error: n.error.issues[0].message };
  const key = ref.queja_id ? "queja_id" : "sac_id";
  const id = ref.queja_id ?? ref.sac_id ?? "";
  if (!uuid.safeParse(id).success) return { ok: false, error: "Registro inválido" };
  const supabase = await createClient();
  const { error } = await supabase.from("calidad_eventos").insert({ [key]: id, tipo: "comentario", nota: n.data });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(ref.queja_id ? `/calidad/quejas/${id}` : `/calidad/sac/${id}`);
  return { ok: true };
}

/** Evidencias (fotos, PDF, Excel, Word) de la queja o de la accion correctiva. */
export async function uploadCalidadFileAction(formData: FormData): Promise<Result> {
  await requireUser();
  const kind = String(formData.get("kind")) === "sac" ? "sac" : "queja";
  const id = String(formData.get("id") ?? "");
  const file = formData.get("file");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Registro inválido" };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Elige un archivo" };
  if (!CALIDAD_FILE_TYPES.includes(file.type)) return { ok: false, error: "Solo PDF, imágenes, Excel o Word" };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "El archivo pesa más de 10 MB" };
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${id}/${randomUUID().slice(0, 8)}-${safe}`;
  const supabase = await createClient();
  const { error: up } = await supabase.storage.from("calidad").upload(path, file, { contentType: file.type });
  if (up) return { ok: false, error: friendlyError(up.message) };
  const { error } = await supabase.from("calidad_archivos").insert({ [kind === "sac" ? "sac_id" : "queja_id"]: id, nombre: file.name.slice(0, 200), path });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(kind === "sac" ? `/calidad/sac/${id}` : `/calidad/quejas/${id}`);
  return { ok: true };
}
