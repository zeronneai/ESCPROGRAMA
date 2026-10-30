import { revisionFolio } from "@/lib/quotes/revisions";
import type { ItemRow } from "@/lib/quotes/types";

export interface TimelineEvent {
  at: string;
  text: string;
}

/**
 * Linea de tiempo derivada de los datos de la solicitud. Sirve para vendedor y
 * comprador y nunca incluye costos. (El comprador ve ademas la bitacora completa.)
 */
export function buildTimeline(
  request: { folio: string; created_at?: string | null; submitted_at: string | null; due_at: string | null },
  items: Array<
    Pick<ItemRow, "folio" | "producto" | "estado" | "not_found_note" | "first_response_at" | "item_quotes" | "item_dispatch"> &
      Partial<Pick<ItemRow, "item_update_requests" | "item_clarification_pauses" | "item_outcomes">>
  >,
  opts: { skipDispatch?: boolean } = {},
): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  if (request.created_at) ev.push({ at: request.created_at, text: "Borrador creado" });
  if (request.submitted_at) ev.push({ at: request.submitted_at, text: `Solicitud ${request.folio} enviada al comprador` });
  for (const i of items) {
    const label = `${i.folio} ${i.producto}`;
    if (i.first_response_at) {
      const firstQuote = [...(i.item_quotes ?? [])].sort((a, b) => a.version - b.version)[0];
      const asQuote = firstQuote && new Date(firstQuote.quoted_at).getTime() - new Date(i.first_response_at).getTime() < 1000;
      if (!asQuote) {
        ev.push({ at: i.first_response_at, text: `${label}: marcada como no encontrada${i.not_found_note ? ` (${i.not_found_note})` : ""}` });
      }
    }
    for (const q of i.item_quotes ?? []) {
      ev.push({ at: q.quoted_at, text: `${label}: cotizada${q.version > 1 ? ` (version ${q.version}, ${revisionFolio(i.folio ?? "", q.version)})` : ""}` });
    }
    for (const d of opts.skipDispatch ? [] : (i.item_dispatch ?? [])) {
      ev.push({ at: d.enviado_at, text: `${label}: enviada al cliente con el Precio ${d.precio_elegido}${d.quote_version > 1 ? ` (version ${d.quote_version})` : ""}` });
    }
    for (const u of i.item_update_requests ?? []) {
      ev.push({ at: u.requested_at, text: `${label}: actualizacion solicitada${u.nota ? ` (${u.nota})` : ""}` });
      if (u.resolved_at) {
        ev.push({ at: u.resolved_at, text: `${label}: actualizacion resuelta ${u.resolution === "sin_cambios" ? "sin cambios" : "con costo actualizado"} (version ${u.resolved_version})` });
      }
    }
    for (const p of i.item_clarification_pauses ?? []) {
      ev.push({ at: p.clarification_requested_at, text: `${label}: aclaracion solicitada (reloj en pausa)` });
      if (p.resumed_at) ev.push({ at: p.resumed_at, text: `${label}: aclaracion respondida (reloj reanudado)` });
    }
    for (const o of i.item_outcomes ?? []) {
      if (o.resultado !== "sin_respuesta") ev.push({ at: o.updated_at, text: `${label}: resultado ${o.resultado === "ganada" ? "ganada" : "perdida"}` });
    }
  }
  return ev.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export const SEND_MEDIUM_LABEL: Record<string, string> = {
  correo: "correo",
  whatsapp: "WhatsApp",
  en_persona: "en persona",
  telefono: "teléfono",
  otro: "otro medio",
};

/** Envios al cliente (por numero) y recotizaciones, para la linea de tiempo. */
export function emissionEvents(
  issues: Array<{ numero: string; sends: Array<{ medio: string; destinatario: string | null; enviado_at: string }> }>,
  renegs: Array<{ motivo: string; abierta_at: string; cerrada_at: string | null; cancelada: boolean }>,
): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  for (const i of issues) {
    i.sends.forEach((s, n) => {
      const to = s.destinatario ? ` a ${s.destinatario}` : "";
      ev.push({ at: s.enviado_at, text: `${n === 0 ? "Cotización" : "Reenvío de la cotización"} ${i.numero} enviada al cliente por ${SEND_MEDIUM_LABEL[s.medio] ?? s.medio}${to}` });
    });
  }
  for (const r of renegs) {
    ev.push({ at: r.abierta_at, text: `Recotización abierta: ${r.motivo}` });
    if (r.cerrada_at && r.cancelada) ev.push({ at: r.cerrada_at, text: "Recotización cancelada (se conservan los precios enviados)" });
  }
  return ev;
}

const ACTION_LABEL: Record<string, string> = {
  insert: "creo",
  update: "modifico",
  delete: "borro",
  login: "inicio sesion",
  logout: "cerro sesion",
  password_changed: "cambio su contraseña",
  password_reset: "restablecio una contraseña",
  user_created: "creo un usuario",
  user_deactivated: "desactivo un usuario",
  user_reactivated: "reactivo un usuario",
  copy_price_table: "copio la tabla de precios",
  download_pdf: "descargo el PDF",
  backfill_valid_until: "respaldo la vigencia de cotizaciones",
};

export function auditActionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}
