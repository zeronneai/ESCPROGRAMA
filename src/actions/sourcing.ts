"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBuyer } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { validateSourcing, type SourcingValues } from "@/lib/validation/sourcing";
import type { Result } from "./requests";

const id = z.string().uuid();

/** Comprador: "Donde conseguirlo (interno)". Editable siempre, aunque la partida ya este cotizada. */
export async function saveSourcingAction(itemId: string, v: SourcingValues): Promise<Result> {
  await requireBuyer();
  if (!id.safeParse(itemId).success) return { ok: false, error: "Partida invalida" };
  const err = validateSourcing(v);
  if (err) return { ok: false, error: err };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_item_sourcing", {
    p_item: itemId,
    p_proveedor: v.proveedor,
    p_link: v.link_producto,
    p_contacto: v.contacto,
    p_parte: v.numero_parte,
    p_notas: v.notas_compra,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/comprador/por-comprar");
  return { ok: true };
}

export async function markPurchasedAction(itemId: string, comprada: boolean): Promise<Result> {
  await requireBuyer();
  if (!id.safeParse(itemId).success) return { ok: false, error: "Partida invalida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_item_purchased", { p_item: itemId, p_comprada: comprada });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/comprador/por-comprar");
  return { ok: true };
}

/** "Usar como base": trae el abastecimiento de otra partida para precargar el formulario. */
export async function getSourcingBaseAction(itemId: string): Promise<Result<{ sourcing: SourcingValues | null }>> {
  await requireBuyer();
  if (!id.safeParse(itemId).success) return { ok: false, error: "Partida invalida" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_item_sourcing", { p_item: itemId });
  if (error) return { ok: false, error: friendlyError(error.message) };
  const r = (data as Array<Record<string, string | null>> | null)?.[0];
  return {
    ok: true,
    sourcing: r
      ? { proveedor: r.proveedor ?? "", link_producto: r.link_producto ?? "", contacto: r.contacto ?? "", numero_parte: r.numero_parte ?? "", notas_compra: r.notas_compra ?? "" }
      : null,
  };
}

export interface SimilarQuote {
  item_id: string;
  version: number;
  folio: string | null;
  producto: string;
  cliente: string;
  quoted_at: string;
  costo: number;
  envio: number | null;
  moneda: "MXN" | "USD";
  proveedor: string | null;
  precio_elegido: number | null;
  valor_elegido: number | null;
  resultado: "sin_respuesta" | "ganada" | "perdida" | null;
  similitud: number;
  descripcion: string;
  alt_nombre: string | null;
  alt_descripcion: string | null;
}

/** Cotizaciones anteriores parecidas (solo comprador). */
export async function searchSimilarAction(input: { name?: string; proveedor?: string; excludeItem?: string }): Promise<Result<{ rows: SimilarQuote[] }>> {
  await requireBuyer();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("similar_quotes", {
    p_name: input.name?.trim() || null,
    p_proveedor: input.proveedor?.trim() || null,
    p_exclude_item: input.excludeItem && id.safeParse(input.excludeItem).success ? input.excludeItem : null,
    p_limit: 15,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  return { ok: true, rows: (data ?? []) as SimilarQuote[] };
}
