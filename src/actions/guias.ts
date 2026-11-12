"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { GUIA_FILE_TYPES, guiaSchema, resumenPartidas, type GuiaInput } from "@/lib/ops/guias";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();
const refresh = (id?: string) => {
  revalidatePath("/guias");
  if (id) revalidatePath(`/guias/${id}`);
};

export async function saveGuiaAction(id: string | null, input: GuiaInput): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (u.rol !== "vendedor") return { ok: false, error: "Las guías las piden los vendedores." };
  const parsed = guiaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  let datos: Record<string, unknown> = parsed.data;
  // Sin la actualizacion 0049 todavia: se guardan los totales y las partidas van en el contenido.
  const sinPartidas = (msg: string) => /partidas|guias_empaque_check/.test(msg);
  const respaldo = () => {
    const { partidas, ...resto } = parsed.data;
    const detalle = partidas.length > 1
      ? partidas.map((p) => `${p.cantidad} ${p.empaque === "tarima" ? "tarima(s)" : "bulto(s)"} ${p.peso_kg} kg c/u${p.largo_cm && p.ancho_cm && p.alto_cm ? ` ${p.largo_cm}x${p.ancho_cm}x${p.alto_cm} cm` : ""}${p.descripcion ? ` (${p.descripcion})` : ""}`).join("; ")
      : "";
    return {
      ...resto,
      empaque: resto.empaque === "mixto" ? "tarima" : resto.empaque,
      contenido: [detalle && `${resumenPartidas(partidas)}: ${detalle}`, resto.contenido].filter(Boolean).join(" · ").slice(0, 300) || null,
    };
  };
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
    let { data, error } = await supabase.from("guias").update(datos).eq("id", id).select("id");
    if (error && sinPartidas(error.message)) ({ data, error } = await supabase.from("guias").update((datos = respaldo())).eq("id", id).select("id"));
    if (error) return { ok: false, error: friendlyError(error.message) };
    if (!data?.length) return { ok: false, error: "Ya no puedes editar esta guía." };
    refresh(id);
    return { ok: true, id };
  }
  let { data, error } = await supabase.from("guias").insert(datos).select("id").single();
  if (error && sinPartidas(error.message)) ({ data, error } = await supabase.from("guias").insert(respaldo()).select("id").single());
  if (error || !data) return { ok: false, error: friendlyError(error?.message ?? "No se pudo guardar") };
  refresh();
  return { ok: true, id: data.id };
}

async function mover(id: string, estado: "en_proceso" | "requiere_datos", nota?: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "marketplaces") return { ok: false, error: "Solo Marketplaces atiende las guías." };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("guia_mover", { p_id: id, p_estado: estado, p_nota: nota?.trim() || null });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}
export async function tomarGuiaAction(id: string): Promise<Result> {
  return mover(id, "en_proceso");
}
export async function pedirDatosGuiaAction(id: string, mensaje: string): Promise<Result> {
  if (mensaje.trim().length < 3) return { ok: false, error: "Escribe qué dato falta." };
  return mover(id, "requiere_datos", mensaje);
}

/** Marketplaces sube la guia (PDF o imagen) y el numero de rastreo. */
export async function subirGuiaAction(formData: FormData): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "marketplaces") return { ok: false, error: "Solo Marketplaces sube las guías." };
  const id = String(formData.get("id") ?? "");
  const rastreo = String(formData.get("rastreo") ?? "").trim().slice(0, 80);
  const file = formData.get("file");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Elige el archivo de la guía" };
  if (!GUIA_FILE_TYPES.includes(file.type)) return { ok: false, error: "La guía debe ser PDF, PNG o JPG" };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "El archivo pesa más de 10 MB" };
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "guia.pdf";
  const path = `${id}/${Date.now()}-${safe}`;
  const supabase = await createClient();
  const { error: up } = await supabase.storage.from("guias").upload(path, file, { contentType: file.type });
  if (up) return { ok: false, error: friendlyError(up.message) };
  const { error } = await supabase.rpc("guia_mover", { p_id: id, p_estado: "lista", p_rastreo: rastreo || null, p_path: path, p_nombre: file.name.slice(0, 200) });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

export async function recordarGuiaAction(id: string): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("guia_recordar", { p_id: id });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

export async function cancelarGuiaAction(id: string, nota: string): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("guia_cancelar", { p_id: id, p_nota: nota.trim() || null });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

export async function commentGuiaAction(id: string, nota: string): Promise<Result> {
  await requireUser();
  const n = z.string().trim().min(2, "Escribe el mensaje").max(1000).safeParse(nota);
  if (!n.success) return { ok: false, error: n.error.issues[0].message };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
  const supabase = await createClient();
  const { error } = await supabase.from("guia_eventos").insert({ guia_id: id, tipo: "comentario", nota: n.data });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}
