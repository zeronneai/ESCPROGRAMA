"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBuyer, requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/validation/request";
import type { Result } from "./requests";

const id = z.string().uuid();
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** Comprador: "Pedir aclaracion". Pausa el reloj de 48 horas habiles hasta que el vendedor responda. */
export async function requestClarificationAction(itemId: string, body: string): Promise<Result> {
  await requireBuyer();
  if (!id.safeParse(itemId).success) return { ok: false, error: "Partida invalida" };
  if (!body.trim()) return { ok: false, error: "Escribe la pregunta para el vendedor" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_clarification", { p_item: itemId, p_body: body.trim().slice(0, 2000) });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/comprador");
  return { ok: true };
}

/** Mensaje del chat de la partida (vendedor o comprador), con imagen opcional. */
export async function postMessageAction(formData: FormData): Promise<Result> {
  const u = await requireUser();
  const itemId = String(formData.get("itemId") ?? "");
  const requestId = String(formData.get("requestId") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
  const file = formData.get("file");
  if (!id.safeParse(itemId).success || !id.safeParse(requestId).success) return { ok: false, error: "Partida invalida" };

  const supabase = await createClient();
  let imagePath: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (!IMAGE_TYPES.includes(file.type)) return { ok: false, error: "Solo se aceptan imágenes PNG, JPG, WEBP o GIF" };
    if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "La imagen pesa más de 5 MB" };
    imagePath = `${requestId}/${itemId}/${randomUUID()}.${EXT[file.type]}`;
    const { error: upErr } = await supabase.storage.from("aclaraciones").upload(imagePath, file, { contentType: file.type });
    if (upErr) return { ok: false, error: friendlyError(upErr.message) };
  }
  if (!body && !imagePath) return { ok: false, error: "Escribe un mensaje o agrega una imagen" };

  const { error } = await supabase.rpc("post_item_message", { p_item: itemId, p_body: body || null, p_image_path: imagePath });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath(u.rol === "comprador" ? `/comprador/solicitudes/${requestId}` : `/vendedor/solicitudes/${requestId}`);
  return { ok: true };
}
