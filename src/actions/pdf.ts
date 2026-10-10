"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { parseShippingPlan } from "@/lib/pdf/shipping";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

async function requireSeller() {
  const u = await requireUser();
  if (u.rol !== "vendedor") throw new Error("No autorizado");
  return u;
}

/** Guarda el precio elegido al elegirlo (editable hasta marcar "Enviado"; despues queda fijo por version). */
export async function choosePriceAction(itemId: string, precio: number): Promise<Result> {
  await requireSeller();
  const parsed = z.object({ itemId: z.string().uuid(), precio: z.number().int().min(1).max(5) }).safeParse({ itemId, precio });
  if (!parsed.success) return { ok: false, error: "Elige uno de los 5 precios" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_item_price_choice", { p_item: parsed.data.itemId, p_precio: parsed.data.precio });
  if (error) return { ok: false, error: friendlyError(error.message) };
  return { ok: true };
}

const pdfSchema = z.object({
  requestId: z.string().uuid(),
  destino: z.string().trim().max(300),
  via: z.string().trim().max(120),
  condiciones: z.string().trim().max(120),
  atencion: z.string().trim().max(200),
  /** Envio al cliente (opcional): va dentro del precio unitario. */
  envioModo: z.enum(["incluido", "por_unidad", "por_pedido", "por_partida"]),
  monto: z.string().max(30).optional(),
  moneda: z.enum(["MXN", "USD", ""]).optional(),
  partidas: z
    .array(z.object({ itemId: z.string().uuid(), monto: z.string().max(30), tipo: z.enum(["unidad", "total"]) }))
    .max(200)
    .optional(),
});
export type PdfDataInput = z.infer<typeof pdfSchema>;

/**
 * Datos del PDF: destino, via, condiciones, atencion y envio al cliente (modo, monto, moneda y partidas), por
 * solicitud y revision, con bitacora. El envio no cambia los 5 precios ni las respuestas del comprador.
 */
export async function savePdfDataAction(input: PdfDataInput): Promise<Result> {
  await requireSeller();
  const parsed = pdfSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();

  // Monedas y partidas de la solicitud (para la moneda por defecto y para validar las partidas).
  const { data: items } = await supabase.from("quote_items").select("id, item_quotes(version, moneda)").eq("request_id", v.requestId);
  const currencies = new Set<"MXN" | "USD">();
  const itemIds: string[] = [];
  for (const i of (items ?? []) as unknown as { id: string; item_quotes: { version: number; moneda: "MXN" | "USD" }[] }[]) {
    itemIds.push(i.id);
    const last = [...(i.item_quotes ?? [])].sort((a, b) => b.version - a.version)[0];
    if (last) currencies.add(last.moneda);
  }
  const ship = parseShippingPlan(
    { modo: v.envioModo, monto: v.monto, moneda: v.moneda, partidas: v.partidas },
    { currencies: (["MXN", "USD"] as const).filter((c) => currencies.has(c)), itemIds },
  );
  if (!ship.ok) return { ok: false, error: ship.error };

  const { error } = await supabase.rpc("save_pdf_envio", {
    p_request: v.requestId,
    p_destino: v.destino || null,
    p_via: v.via || null,
    p_condiciones: v.condiciones || null,
    p_atencion: v.atencion || null,
    p_modo: ship.db.modo,
    p_monto: ship.db.monto,
    p_moneda: ship.db.moneda,
    p_items: ship.db.partidas,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath(`/vendedor/solicitudes/${v.requestId}`);
  return { ok: true };
}
