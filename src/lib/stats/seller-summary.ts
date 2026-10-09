import type { ItemStatus } from "@/lib/quotes/types";

export type ViewState = ItemStatus | "vencida";

/** Estado visible de una partida: pendiente con plazo cumplido es "vencida". */
export function viewState(estado: ItemStatus, dueAt: string | null, now: Date): ViewState {
  if (estado === "pendiente" && dueAt && now.getTime() >= new Date(dueAt).getTime()) return "vencida";
  return estado;
}

export interface SellerCounters {
  solicitudes: number;
  pendientes: number;
  respondidas: number;
  noEncontradas: number;
  vencidas: number;
  enviadas: number;
  /** Respondidas (cotizadas) que el vendedor aun no marca como enviadas. */
  sinEnviar: number;
}

export function summarizeSeller(
  items: { requestId: string; estado: ItemStatus; dueAt: string | null }[],
  now: Date,
): SellerCounters {
  const c: SellerCounters = { solicitudes: 0, pendientes: 0, respondidas: 0, noEncontradas: 0, vencidas: 0, enviadas: 0, sinEnviar: 0 };
  c.solicitudes = new Set(items.map((i) => i.requestId)).size;
  for (const i of items) {
    const s = viewState(i.estado, i.dueAt, now);
    if (s === "pendiente") c.pendientes++;
    else if (s === "vencida") c.vencidas++;
    else if (s === "no_encontrada") { c.noEncontradas++; c.respondidas++; }
    else if (s === "cotizada") { c.sinEnviar++; c.respondidas++; }
    else if (s === "enviada_cliente") { c.enviadas++; c.respondidas++; }
  }
  return c;
}
