"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBuyer, requireUser } from "@/lib/auth/guards";
import { calcTabulador, type PricingFactors } from "@/lib/pricing/tabulador";
import { netResponseHours } from "@/lib/quotes/clock";
import { friendlyError, getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { addBusinessHours } from "@/lib/time/business-hours";
import { parseQuoteForm, type QuoteFormValues } from "@/lib/validation/response";
import type { Result } from "./requests";

const id = z.string().uuid();

/** Vendedor: "Solicitar actualizacion" de una cotizacion con la vigencia vencida. */
export async function requestUpdateAction(itemId: string, nota: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "vendedor") return { ok: false, error: "No autorizado" };
  if (!id.safeParse(itemId).success) return { ok: false, error: "Partida invalida" };
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  // Plazo del comprador: 48 horas habiles desde ahora (fines de semana y festivos no cuentan).
  const due = addBusinessHours(new Date(), cfg.slaHours, cfg);
  const { error } = await supabase.rpc("request_item_update", {
    p_item: itemId,
    p_nota: nota.trim().slice(0, 500) || null,
    p_due_at: due.toISOString(),
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/vendedor");
  return { ok: true };
}

async function revisionHours(itemId: string) {
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const [{ data: req }, { data: pauses }, { data: item }] = await Promise.all([
    supabase.from("item_update_requests").select("requested_at").eq("item_id", itemId).is("resolved_at", null).maybeSingle(),
    supabase.from("item_clarification_pauses").select("clarification_requested_at, resumed_at").eq("item_id", itemId),
    supabase.from("quote_items").select("request_id").eq("id", itemId).single(),
  ]);
  if (!req) return { hours: null as number | null, requestId: item?.request_id as string | undefined };
  const since = new Date(req.requested_at);
  const relevant = (pauses ?? []).filter((p) => new Date(p.clarification_requested_at) >= since);
  return {
    hours: Math.round(netResponseHours(since, new Date(), relevant, cfg) * 100) / 100,
    requestId: item?.request_id as string | undefined,
  };
}

/** Comprador: responde una actualizacion solicitada. */
export async function respondRevisionAction(
  itemId: string,
  mode: "confirm" | "update_cost",
  values?: QuoteFormValues,
  nota?: string,
): Promise<Result> {
  await requireBuyer();
  if (!id.safeParse(itemId).success) return { ok: false, error: "Partida invalida" };
  const supabase = await createClient();
  const rh = await revisionHours(itemId);

  let payload: Record<string, unknown>;
  if (mode === "confirm") {
    payload = { nota: nota?.trim() || null, response_hours: rh.hours };
  } else {
    if (!values) return { ok: false, error: "Captura el costo nuevo" };
    const parsed = parseQuoteForm(values);
    if (!parsed.ok) return { ok: false, error: "Revisa los campos marcados", problems: Object.values(parsed.errors) };
    const q = parsed.value;
    const { data: cfg } = await supabase
      .from("pricing_config")
      .select("no_shipping_markup, p1, p2, p3, p4, p5")
      .order("id", { ascending: false })
      .limit(1)
      .single();
    if (!cfg) return { ok: false, error: "No hay configuracion del tabulador" };
    const factors: PricingFactors = { noShippingMarkup: cfg.no_shipping_markup, p1: cfg.p1, p2: cfg.p2, p3: cfg.p3, p4: cfg.p4, p5: cfg.p5 };
    const t = calcTabulador(q.costo, q.envio, factors);
    payload = {
      costo: q.costo,
      envio: q.envio,
      moneda: q.moneda,
      factors: { no_shipping_markup: cfg.no_shipping_markup, p1: cfg.p1, p2: cfg.p2, p3: cfg.p3, p4: cfg.p4, p5: cfg.p5 },
      prices: { p1: t.p1, p2: t.p2, p3: t.p3, p4: t.p4, p5: t.p5 },
      entrega: q.entrega,
      compra_min: q.compra_min,
      proveedor: q.proveedor,
      nota: q.nota,
      // Siempre se manda: el formulario parte de la version anterior, asi que "solicitado" quita el alternativo.
      alternativo: q.alternativo,
      response_hours: rh.hours,
    };
  }
  const { error } = await supabase.rpc("respond_item", { p_item: itemId, p_action: mode, p_payload: payload });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/comprador");
  if (rh.requestId) revalidatePath(`/comprador/solicitudes/${rh.requestId}`);
  return { ok: true };
}
