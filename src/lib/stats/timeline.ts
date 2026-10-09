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
  items: Array<Pick<ItemRow, "folio" | "producto" | "estado" | "not_found_note" | "first_response_at" | "item_quotes" | "item_dispatch">>,
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
      ev.push({ at: q.quoted_at, text: `${label}: cotizada${q.version > 1 ? ` (version ${q.version})` : ""}` });
    }
    for (const d of i.item_dispatch ?? []) {
      ev.push({ at: d.enviado_at, text: `${label}: enviada al cliente con el Precio ${d.precio_elegido}` });
    }
  }
  return ev.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
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
};

export function auditActionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}
