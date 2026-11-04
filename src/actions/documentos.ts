"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { cambioSchema, documentoSchema, MAX_DOC_BYTES, type CambioInput } from "@/lib/documentos";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();
const soloIso = async () => {
  const u = await requireUser();
  return u.rol === "coordinador_iso" ? u : null;
};

/** Subir un documento (PDF). Con `reemplaza` es la version nueva de uno que ya existe. */
export async function subirDocumentoAction(fd: FormData): Promise<Result<{ id: string }>> {
  if (!(await soloIso())) return { ok: false, error: "Solo el Coordinador ISO sube documentos." };
  const parsed = documentoSchema.safeParse({
    codigo: String(fd.get("codigo") ?? ""),
    titulo: String(fd.get("titulo") ?? ""),
    categoria: String(fd.get("categoria") ?? ""),
    version: String(fd.get("version") ?? ""),
    fecha_emision: String(fd.get("fecha_emision") ?? ""),
    descripcion: String(fd.get("descripcion") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const reemplaza = String(fd.get("reemplaza") ?? "");
  if (reemplaza && !uuid.safeParse(reemplaza).success) return { ok: false, error: "Documento inválido" };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Elige el PDF" };
  if (file.type !== "application/pdf") return { ok: false, error: "Solo archivos PDF" };
  if (file.size > MAX_DOC_BYTES) return { ok: false, error: "El PDF pesa más de 10 MB" };
  const id = randomUUID();
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${id}/${safe}`;
  const supabase = await createClient();
  const { error: up } = await supabase.storage.from("documentos").upload(path, file, { contentType: "application/pdf" });
  if (up) return { ok: false, error: friendlyError(up.message) };
  const { error } = await supabase.from("documentos").insert({
    id, ...parsed.data, path, nombre_archivo: file.name.slice(0, 200), tamano: file.size, reemplaza_id: reemplaza || null,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/documentos");
  return { ok: true, id };
}

/** Corregir datos (titulo, codigo, categoria...) sin cambiar el archivo. */
export async function editarDocumentoAction(id: string, input: Record<string, string>): Promise<Result> {
  if (!(await soloIso())) return { ok: false, error: "Solo el Coordinador ISO edita documentos." };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Documento inválido" };
  const parsed = documentoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("documentos").update(parsed.data).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "No se pudo editar." };
  revalidatePath("/documentos");
  return { ok: true };
}

/** Dar de baja (deja de estar vigente; queda en el historial) o reactivar. */
export async function bajaDocumentoAction(id: string, vigente: boolean, motivo: string): Promise<Result> {
  if (!(await soloIso())) return { ok: false, error: "Solo el Coordinador ISO da de baja documentos." };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Documento inválido" };
  if (!vigente && motivo.trim().length < 3) return { ok: false, error: "Escribe el motivo de la baja" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documentos")
    .update(vigente ? { vigente: true, baja_at: null, baja_motivo: null } : { vigente: false, baja_at: new Date().toISOString(), baja_motivo: motivo.trim().slice(0, 300) })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "No se pudo cambiar." };
  revalidatePath("/documentos");
  return { ok: true };
}

/** Control de cambios: alta o edicion (solo Coordinador ISO). */
export async function saveCambioAction(id: string | null, input: CambioInput): Promise<Result<{ id: string }>> {
  if (!(await soloIso())) return { ok: false, error: "Solo el Coordinador ISO registra el control de cambios." };
  const parsed = cambioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Registro inválido" };
    const { data, error } = await supabase.from("control_cambios").update(parsed.data).eq("id", id).select("id");
    if (error) return { ok: false, error: friendlyError(error.message) };
    if (!data?.length) return { ok: false, error: "No se pudo guardar." };
    revalidatePath("/calidad/cambios");
    revalidatePath(`/calidad/cambios/${id}`);
    return { ok: true, id };
  }
  const { data, error } = await supabase.from("control_cambios").insert(parsed.data).select("id").single();
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/calidad/cambios");
  return { ok: true, id: data.id };
}
