"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBuyer, requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const TIPOS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const uuid = z.string().uuid();

/** El comprador sube la imagen de confirmacion de una partida (reemplaza la anterior). */
export async function subirFotoCompraAction(fd: FormData): Promise<Result> {
  await requireBuyer();
  const itemId = String(fd.get("itemId") ?? "");
  const requestId = String(fd.get("requestId") ?? "");
  const file = fd.get("file");
  if (!uuid.safeParse(itemId).success || !uuid.safeParse(requestId).success) return { ok: false, error: "Partida inválida" };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Elige la imagen" };
  if (!TIPOS[file.type]) return { ok: false, error: "La imagen debe ser JPG, PNG o WEBP" };
  if (file.size > 8 * 1024 * 1024) return { ok: false, error: "La imagen pesa más de 8 MB" };
  const supabase = await createClient();
  const path = `${requestId}/${itemId}/compra-${randomUUID()}.${TIPOS[file.type]}`;
  const { error: up } = await supabase.storage.from("aclaraciones").upload(path, file, { contentType: file.type });
  if (up) return { ok: false, error: friendlyError(up.message) };
  const { error } = await supabase.rpc("item_foto_compra", { p_item: itemId, p_path: path, p_nombre: file.name.slice(0, 200) });
  if (error) return { ok: false, error: /item_foto_compra|foto_compra/.test(error.message) ? "Primero corre la actualización 0052 en Supabase." : friendlyError(error.message) };
  revalidatePath(`/comprador/solicitudes/${requestId}`);
  return { ok: true };
}

export async function quitarFotoCompraAction(itemId: string, requestId: string): Promise<Result> {
  await requireBuyer();
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "Partida inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("item_foto_compra", { p_item: itemId, p_path: null, p_nombre: null });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath(`/comprador/solicitudes/${requestId}`);
  return { ok: true };
}

/** Liga temporal para ver o descargar la imagen (comprador o vendedor de la solicitud). */
export async function urlFotoCompraAction(itemId: string, descargar: boolean): Promise<{ url: string } | { error: string }> {
  await requireUser();
  if (!uuid.safeParse(itemId).success) return { error: "Partida inválida" };
  const supabase = await createClient();
  const { data } = await supabase.from("quote_items").select("foto_compra_path, foto_compra_nombre").eq("id", itemId).maybeSingle();
  const it = data as { foto_compra_path: string | null; foto_compra_nombre: string | null } | null;
  if (!it?.foto_compra_path) return { error: "No hay imagen" };
  const { data: s } = await supabase.storage.from("aclaraciones").createSignedUrl(it.foto_compra_path, 600, descargar ? { download: it.foto_compra_nombre || "imagen.jpg" } : undefined);
  return s?.signedUrl ? { url: s.signedUrl } : { error: "No se pudo abrir la imagen" };
}
