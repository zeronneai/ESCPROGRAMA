"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { normalizar, type Articulo } from "@/lib/articulos";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();
const qty = z.union([z.null(), z.coerce.number().positive().max(9_999_999)]);

/** Busca en el catalogo por clave o nombre (todas las palabras, sin importar acentos). */
export async function searchArticulosAction(q: string, soloVendibles = true): Promise<Articulo[]> {
  await requireUser();
  const words = normalizar(q).replace(/[%_,()]/g, " ").split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
  if (!words.length) return [];
  const supabase = await createClient();
  let query = supabase.from("articulos").select("id, clave, nombre, familia, estatus, vendible");
  for (const w of words) query = query.ilike("busqueda", `%${w}%`);
  if (soloVendibles) query = query.eq("vendible", true);
  const { data } = await query.order("nombre").limit(15);
  return (data ?? []) as Articulo[];
}

const refresh = (id: string) => {
  revalidatePath("/vendedor/bitacora");
  revalidatePath(`/vendedor/bitacora/${id}`);
};

export async function addBitacoraArticuloAction(bitacoraId: string, articuloId: string, cantidad: number | null): Promise<Result<{ id: string }>> {
  await requireUser();
  if (!uuid.safeParse(bitacoraId).success || !uuid.safeParse(articuloId).success) return { ok: false, error: "Artículo inválido" };
  const c = qty.safeParse(cantidad);
  if (!c.success) return { ok: false, error: "Cantidad inválida" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("bitacora_articulos").insert({ bitacora_id: bitacoraId, articulo_id: articuloId, cantidad: c.data }).select("id").single();
  if (error) return { ok: false, error: /duplicate/i.test(error.message) ? "Ese artículo ya está en el registro." : friendlyError(error.message) };
  refresh(bitacoraId);
  return { ok: true, id: data.id };
}

export async function updateBitacoraArticuloAction(bitacoraId: string, id: string, cantidad: number | null): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Artículo inválido" };
  const c = qty.safeParse(cantidad);
  if (!c.success) return { ok: false, error: "Cantidad inválida" };
  const supabase = await createClient();
  const { error } = await supabase.from("bitacora_articulos").update({ cantidad: c.data }).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(bitacoraId);
  return { ok: true };
}

export async function removeBitacoraArticuloAction(bitacoraId: string, id: string): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Artículo inválido" };
  const supabase = await createClient();
  const { error } = await supabase.from("bitacora_articulos").delete().eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(bitacoraId);
  return { ok: true };
}
