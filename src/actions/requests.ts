"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError, getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { addBusinessHours } from "@/lib/time/business-hours";
import {
  formatProblems,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  requestDraftSchema,
  submitProblems,
  toDraftPayload,
} from "@/lib/validation/request";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; problems?: string[] };

async function requireSeller() {
  const u = await requireUser();
  if (u.rol !== "vendedor") throw new Error("No autorizado");
  return u;
}

export async function saveDraftAction(input: unknown): Promise<Result<{ id: string }>> {
  await requireSeller();
  const parsed = requestDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Elige el cliente antes de guardar el borrador." };
  const fp = formatProblems(parsed.data);
  if (fp.length) return { ok: false, error: fp[0], problems: fp };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_draft", { p_payload: toDraftPayload(parsed.data) });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/vendedor");
  return { ok: true, id: parsed.data.request_id };
}

export async function submitRequestAction(input: unknown): Promise<Result<{ id: string }>> {
  await requireSeller();
  const parsed = requestDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Elige el cliente antes de enviar." };

  // Capa 2 de validacion (servidor): mismas reglas que la interfaz.
  const problems = [...formatProblems(parsed.data), ...submitProblems(parsed.data).map((p) => p.message)];
  if (problems.length) return { ok: false, error: "Faltan datos obligatorios", problems };

  const supabase = await createClient();
  const { error: saveError } = await supabase.rpc("save_draft", { p_payload: toDraftPayload(parsed.data) });
  if (saveError) return { ok: false, error: friendlyError(saveError.message) };

  const cfg = await getBusinessSettings(supabase);
  const dueAt = addBusinessHours(new Date(), cfg.slaHours, cfg);
  // Capa 3 (BD): el trigger vuelve a validar todo, asigna folios y fija submitted_at.
  const { error } = await supabase
    .from("quote_requests")
    .update({ estado: "enviada", due_at: dueAt.toISOString() })
    .eq("id", parsed.data.request_id);
  if (error) return { ok: false, error: friendlyError(error.message) };

  revalidatePath("/vendedor");
  return { ok: true, id: parsed.data.request_id };
}

export async function discardDraftAction(requestId: string): Promise<Result> {
  await requireSeller();
  if (!z.string().uuid().safeParse(requestId).success) return { ok: false, error: "Solicitud invalida" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quote_requests")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("estado", "borrador")
    .select("id");
  if (error || !data?.length) return { ok: false, error: "No se pudo descartar el borrador" };
  revalidatePath("/vendedor");
  return { ok: true };
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** Sube una imagen de referencia al bucket privado. Requiere que el borrador ya exista. */
export async function uploadReferenceAction(
  formData: FormData,
): Promise<Result<{ id: string; path: string; signedUrl: string | null }>> {
  await requireSeller();
  const requestId = String(formData.get("requestId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const file = formData.get("file");
  if (!z.string().uuid().safeParse(requestId).success || !z.string().uuid().safeParse(itemId).success) {
    return { ok: false, error: "Solicitud invalida" };
  }
  if (!(file instanceof File)) return { ok: false, error: "Falta el archivo" };
  if (!IMAGE_TYPES.includes(file.type)) return { ok: false, error: "Solo se aceptan imagenes PNG, JPG, WEBP o GIF" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "La imagen pesa mas de 5 MB" };

  const supabase = await createClient();
  const id = randomUUID();
  const path = `${requestId}/${itemId}/${id}.${EXT[file.type]}`;
  const { error } = await supabase.storage.from("references").upload(path, file, { contentType: file.type });
  if (error) return { ok: false, error: friendlyError(error.message) };
  const { data } = await supabase.storage.from("references").createSignedUrl(path, 3600);
  return { ok: true, id, path, signedUrl: data?.signedUrl ?? null };
}

export async function markDispatchedAction(itemId: string, precio: number): Promise<Result> {
  await requireSeller();
  const parsed = z.object({ itemId: z.string().uuid(), precio: z.number().int().min(1).max(5) }).safeParse({ itemId, precio });
  if (!parsed.success) return { ok: false, error: "Elige uno de los 5 precios" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_item_dispatched", { p_item: parsed.data.itemId, p_precio: parsed.data.precio });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/vendedor");
  return { ok: true };
}

/** Bitacora de copiado: solo metadatos, nunca el contenido copiado. */
export async function logCopyAction(entityId: string, meta: { scope: "item" | "request" | "selected"; count: number }): Promise<void> {
  await requireSeller();
  if (!z.string().uuid().safeParse(entityId).success) return;
  const supabase = await createClient();
  await supabase.rpc("log_event", {
    p_action: "copy_price_table",
    p_entity: meta.scope === "request" ? "quote_requests" : "quote_items",
    p_entity_id: entityId,
    p_meta: { scope: meta.scope, count: meta.count },
  });
}
