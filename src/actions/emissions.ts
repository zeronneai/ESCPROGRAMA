"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { PdfNotReadyError } from "@/lib/pdf/model";
import { buildLiveQuoteModel, emissionState } from "@/lib/pdf/server";
import { friendlyError } from "@/lib/quotes/server";
import type { ItemRow } from "@/lib/quotes/types";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

async function requireSeller() {
  const u = await requireUser();
  if (u.rol !== "vendedor") throw new Error("No autorizado");
  return u;
}

import { SEND_MEDIA } from "@/lib/quotes/send-media";
export type { SendMedium } from "@/lib/quotes/send-media";

const sendSchema = z.object({
  medio: z.enum(SEND_MEDIA, { message: "Elige por qué medio se envió" }),
  destinatario: z.string().trim().max(200).optional(),
  nota: z.string().trim().max(500).optional(),
});
const uuid = z.string().uuid();
const refresh = (requestId: string) => {
  revalidatePath(`/vendedor/solicitudes/${requestId}`);
  revalidatePath("/vendedor");
};

/**
 * Registra la cotizacion como enviada al cliente: guarda una copia fija del PDF con su numero,
 * fija los precios enviados y deja el envio (medio, destinatario, fecha y usuario) en la bitacora.
 */
export async function issueQuoteAction(
  requestId: string,
  input: z.input<typeof sendSchema>,
): Promise<Result<{ numero: string; issueId: string }>> {
  await requireSeller();
  if (!uuid.safeParse(requestId).success) return { ok: false, error: "Solicitud inválida" };
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: req } = await supabase.from("quote_requests").select("id, folio").eq("id", requestId).maybeSingle();
  if (!req?.folio) return { ok: false, error: "Solicitud no encontrada" };
  const { data: items } = await supabase.from("quote_items").select("estado, item_quotes(version, valid_until)").eq("request_id", requestId);
  const state = await emissionState(supabase, { id: req.id, folio: req.folio }, (items ?? []) as unknown as ItemRow[]);
  if (!state.canIssue) return { ok: false, error: 'Esta cotización ya está registrada como enviada. Usa "Registrar otro envío" o "Recotizar".' };

  let snapshot;
  try {
    const live = await buildLiveQuoteModel(supabase, requestId, state.nextNumero);
    if (!live) return { ok: false, error: "Solicitud no encontrada" };
    snapshot = live.model;
  } catch (e) {
    if (e instanceof PdfNotReadyError) return { ok: false, error: e.problems[0], problems: e.problems };
    throw e;
  }
  const { data, error } = await supabase.rpc("issue_quote", {
    p_request: requestId,
    p_medio: parsed.data.medio,
    p_destinatario: parsed.data.destinatario || null,
    p_nota: parsed.data.nota || null,
    p_snapshot: snapshot,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  const row = (data as { issue_id: string; numero: string }[] | null)?.[0];
  refresh(requestId);
  return { ok: true, numero: row?.numero ?? state.nextNumero, issueId: row?.issue_id ?? "" };
}

/** Otro envio del mismo numero (por ejemplo, tambien por WhatsApp). No cambia nada de la cotizacion. */
export async function registerSendAction(requestId: string, issueId: string, input: z.input<typeof sendSchema>): Promise<Result> {
  await requireSeller();
  if (!uuid.safeParse(issueId).success || !uuid.safeParse(requestId).success) return { ok: false, error: "Cotización inválida" };
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_issue_send", {
    p_issue: issueId,
    p_medio: parsed.data.medio,
    p_destinatario: parsed.data.destinatario || null,
    p_nota: parsed.data.nota || null,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(requestId);
  return { ok: true };
}

export async function openRenegotiationAction(requestId: string, motivo: string): Promise<Result> {
  await requireSeller();
  if (!uuid.safeParse(requestId).success) return { ok: false, error: "Solicitud inválida" };
  const m = z.string().trim().min(3, "Escribe el motivo de la recotización").max(500).safeParse(motivo);
  if (!m.success) return { ok: false, error: m.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("open_renegotiation", { p_request: requestId, p_motivo: m.data });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(requestId);
  return { ok: true };
}

export async function cancelRenegotiationAction(requestId: string): Promise<Result> {
  await requireSeller();
  if (!uuid.safeParse(requestId).success) return { ok: false, error: "Solicitud inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_renegotiation", { p_request: requestId });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(requestId);
  return { ok: true };
}
