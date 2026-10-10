"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBuyer } from "@/lib/auth/guards";
import { calcTabulador, type PricingFactors } from "@/lib/pricing/tabulador";
import { friendlyError, getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { netResponseHours } from "@/lib/quotes/clock";
import { parseNotFoundNote, parseQuoteForm, type QuoteFormValues } from "@/lib/validation/response";
import type { Result } from "./requests";

const idSchema = z.string().uuid();

/** Horas habiles desde que se envio la solicitud hasta ahora (para estadisticas). */
async function responseHours(itemId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("quote_items")
    .select("request_id, quote_requests(submitted_at)")
    .eq("id", itemId)
    .single();
  const submitted = (data?.quote_requests as unknown as { submitted_at: string } | null)?.submitted_at;
  if (!submitted) return null;
  const cfg = await getBusinessSettings(supabase);
  // Horas habiles de respuesta SIN contar el tiempo en pausa por aclaraciones.
  const { data: pauses } = await supabase.from("item_clarification_pauses").select("clarification_requested_at, resumed_at").eq("item_id", itemId);
  const hours = netResponseHours(new Date(submitted), new Date(), pauses ?? [], cfg);
  return { hours: Math.round(hours * 100) / 100, requestId: data!.request_id as string };
}

export async function respondQuoteAction(itemId: string, values: QuoteFormValues): Promise<Result> {
  await requireBuyer();
  if (!idSchema.safeParse(itemId).success) return { ok: false, error: "Partida invalida" };
  const parsed = parseQuoteForm(values);
  if (!parsed.ok) return { ok: false, error: "Revisa los campos marcados", problems: Object.values(parsed.errors) };
  const q = parsed.value;

  const supabase = await createClient();
  const { data: cfg } = await supabase
    .from("pricing_config")
    .select("no_shipping_markup, p1, p2, p3, p4, p5")
    .order("id", { ascending: false })
    .limit(1)
    .single();
  if (!cfg) return { ok: false, error: "No hay configuracion del tabulador" };
  const factors: PricingFactors = {
    noShippingMarkup: cfg.no_shipping_markup,
    p1: cfg.p1,
    p2: cfg.p2,
    p3: cfg.p3,
    p4: cfg.p4,
    p5: cfg.p5,
  };
  const t = calcTabulador(q.costo, q.envio, factors);
  const rh = await responseHours(itemId);

  const { error } = await supabase.rpc("respond_item", {
    p_item: itemId,
    p_action: "quote",
    p_payload: {
      costo: q.costo,
      envio: q.envio,
      moneda: q.moneda,
      // Snapshot de los factores usados (la BD verifica que sean los vigentes).
      factors: {
        no_shipping_markup: cfg.no_shipping_markup,
        p1: cfg.p1,
        p2: cfg.p2,
        p3: cfg.p3,
        p4: cfg.p4,
        p5: cfg.p5,
      },
      prices: { p1: t.p1, p2: t.p2, p3: t.p3, p4: t.p4, p5: t.p5 },
      entrega: q.entrega,
      compra_min: q.compra_min,
      proveedor: q.proveedor,
      nota: q.nota,
      response_hours: rh?.hours ?? null,
    },
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/comprador");
  if (rh) revalidatePath(`/comprador/solicitudes/${rh.requestId}`);
  return { ok: true };
}

export async function respondNotFoundAction(itemId: string, nota: string): Promise<Result> {
  await requireBuyer();
  if (!idSchema.safeParse(itemId).success) return { ok: false, error: "Partida invalida" };
  const parsed = parseNotFoundNote(nota);
  if (!parsed.ok) return { ok: false, error: parsed.errors.nota };
  const rh = await responseHours(itemId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_item", {
    p_item: itemId,
    p_action: "not_found",
    p_payload: { nota: parsed.value.nota, response_hours: rh?.hours ?? null },
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/comprador");
  if (rh) revalidatePath(`/comprador/solicitudes/${rh.requestId}`);
  return { ok: true };
}
