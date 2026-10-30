import type { ItemStatus } from "@/lib/quotes/types";

/**
 * Etapa de una solicitud desde el punto de vista del vendedor (una por solicitud, no por partida).
 * Orden de prioridad: lo que requiere accion del vendedor primero.
 */
export type Stage = "recotizando" | "aclaracion" | "por_enviar" | "con_compras" | "con_cliente" | "ganada" | "perdida" | "cerrada";

export const STAGE_INFO: Record<Stage, { label: string; chip: string; group: PipelineGroup }> = {
  recotizando: { label: "Recotizando", chip: "bg-amber-100 text-amber-900 ring-amber-300", group: "por_enviar" },
  aclaracion: { label: "Responde aclaración", chip: "bg-purple-100 text-purple-900 ring-purple-300", group: "con_compras" },
  por_enviar: { label: "Lista para enviar", chip: "bg-amber-100 text-amber-900 ring-amber-300", group: "por_enviar" },
  con_compras: { label: "Con compras", chip: "bg-sky-100 text-sky-900 ring-sky-200", group: "con_compras" },
  con_cliente: { label: "Con el cliente", chip: "bg-indigo-100 text-indigo-900 ring-indigo-200", group: "con_cliente" },
  ganada: { label: "Ganada", chip: "bg-green-100 text-green-800 ring-green-200", group: "ganada" },
  perdida: { label: "Perdida", chip: "bg-slate-200 text-slate-700 ring-slate-300", group: "cerrada" },
  cerrada: { label: "Sin cotizar", chip: "bg-slate-100 text-slate-600 ring-slate-200", group: "cerrada" },
};

export type PipelineGroup = "con_compras" | "por_enviar" | "con_cliente" | "ganada" | "cerrada";
export const PIPELINE: { id: PipelineGroup; label: string; hint: string; bar: string; text: string }[] = [
  { id: "con_compras", label: "Con compras", hint: "Esperando precio", bar: "bg-sky-500", text: "text-sky-700" },
  { id: "por_enviar", label: "Por enviar", hint: "Ya tienen precio", bar: "bg-amber-500", text: "text-amber-700" },
  { id: "con_cliente", label: "Con el cliente", hint: "Esperando respuesta", bar: "bg-indigo-500", text: "text-indigo-700" },
  { id: "ganada", label: "Ganadas", hint: "Vendidas", bar: "bg-green-600", text: "text-green-700" },
  { id: "cerrada", label: "Cerradas", hint: "Perdidas o sin cotizar", bar: "bg-slate-400", text: "text-slate-600" },
];

export interface PipelineItem {
  estado: ItemStatus;
  item_quotes: { version: number; valid_until: string | null }[];
  item_dispatch: { quote_version: number; enviado_at: string }[];
  item_outcomes: { quote_version: number; resultado: "sin_respuesta" | "ganada" | "perdida" }[];
}

export interface PipelineRequest {
  items: PipelineItem[];
  renegotiationOpen: boolean;
  /** Ultimo envio registrado al cliente (emision o partida), si hay. */
  lastSentAt: string | null;
}

export interface StageResult {
  stage: Stage;
  /** Partidas en cada situacion. */
  counts: { total: number; conCompras: number; porEnviar: number; enviadas: number; ganadas: number; perdidas: number };
  /** Requiere que el vendedor haga algo. */
  action: null | { tone: "purple" | "amber" | "red" | "indigo"; text: string };
  /** Dias desde el ultimo envio sin respuesta del cliente. */
  diasSinRespuesta: number | null;
}

const latest = <T extends { version?: number; quote_version?: number }>(a: T[]) =>
  [...a].sort((x, y) => (y.version ?? y.quote_version ?? 0) - (x.version ?? x.quote_version ?? 0))[0];

export const FOLLOW_UP_DAYS = 5;

export function requestStage(r: PipelineRequest, now: Date): StageResult {
  const items = r.items;
  const conCompras = items.filter((i) => i.estado === "pendiente" || i.estado === "actualizacion_solicitada" || i.estado === "esperando_aclaracion").length;
  const porEnviar = items.filter((i) => i.estado === "cotizada").length;
  const sent = items.filter((i) => i.item_dispatch.length > 0);
  const outcome = (i: PipelineItem) => (i.item_outcomes.length ? latest(i.item_outcomes).resultado : "sin_respuesta");
  const ganadas = sent.filter((i) => outcome(i) === "ganada").length;
  const perdidas = sent.filter((i) => outcome(i) === "perdida").length;
  const abiertas = sent.filter((i) => outcome(i) === "sin_respuesta" && i.estado === "enviada_cliente");
  const counts = { total: items.length, conCompras, porEnviar, enviadas: sent.length, ganadas, perdidas };
  const dias = r.lastSentAt ? Math.floor((now.getTime() - new Date(r.lastSentAt).getTime()) / 86_400_000) : null;
  const vencidas = abiertas.filter((i) => {
    const q = i.item_quotes.length ? latest(i.item_quotes) : null;
    return !!q?.valid_until && new Date(q.valid_until).getTime() < now.getTime();
  }).length;

  let stage: Stage;
  if (r.renegotiationOpen) stage = "recotizando";
  else if (items.some((i) => i.estado === "esperando_aclaracion")) stage = "aclaracion";
  else if (porEnviar > 0) stage = "por_enviar";
  else if (conCompras > 0) stage = "con_compras";
  else if (abiertas.length > 0) stage = "con_cliente";
  else if (ganadas > 0) stage = "ganada";
  else if (perdidas > 0) stage = "perdida";
  else if (sent.length > 0) stage = "con_cliente";
  else stage = "cerrada";

  let action: StageResult["action"] = null;
  if (stage === "aclaracion") action = { tone: "purple", text: "Compras te pidió una aclaración" };
  else if (stage === "recotizando") action = { tone: "amber", text: "Recotización abierta: registra el envío" };
  else if (stage === "por_enviar") action = { tone: "amber", text: `${porEnviar} partida(s) lista(s) para enviar al cliente` };
  else if (stage === "con_cliente" && vencidas > 0) action = { tone: "red", text: "Vigencia vencida: solicita actualización o cierra" };
  else if (stage === "con_cliente" && dias !== null && dias >= FOLLOW_UP_DAYS) action = { tone: "indigo", text: `${dias} días sin respuesta: da seguimiento` };

  return { stage, counts, action, diasSinRespuesta: stage === "con_cliente" ? dias : null };
}
