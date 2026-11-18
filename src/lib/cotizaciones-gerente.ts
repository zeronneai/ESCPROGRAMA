/** Etapa de una solicitud vista por la gerente (lectura). */
export type EtapaSolicitud = "por_cotizar" | "cotizada" | "con_cliente" | "ganada" | "perdida" | "parcial";

export const ETAPAS: Record<EtapaSolicitud, { label: string; cls: string }> = {
  por_cotizar: { label: "Por cotizar", cls: "bg-amber-100 text-amber-800" },
  cotizada: { label: "Cotizada, falta mandar al cliente", cls: "bg-green-100 text-green-800" },
  con_cliente: { label: "Con el cliente", cls: "bg-brand-100 text-brand-800" },
  ganada: { label: "Ganada", cls: "bg-emerald-600 text-white" },
  perdida: { label: "Perdida", cls: "bg-red-100 text-red-800" },
  parcial: { label: "Ganada en parte", cls: "bg-emerald-100 text-emerald-800" },
};

type ItemMin = { estado: string; item_outcomes?: { resultado: string; quote_version: number }[] | null };

export function etapaSolicitud(items: ItemMin[], emitida: boolean): EtapaSolicitud {
  if (items.some((i) => ["pendiente", "actualizacion_solicitada", "esperando_aclaracion"].includes(i.estado))) return "por_cotizar";
  const res = items.map((i) => [...(i.item_outcomes ?? [])].sort((a, b) => b.quote_version - a.quote_version)[0]?.resultado ?? "sin_respuesta");
  const cotizables = items.filter((i) => i.estado !== "no_encontrada").length;
  const ganadas = res.filter((r) => r === "ganada").length;
  const perdidas = res.filter((r) => r === "perdida").length;
  if (ganadas && ganadas === cotizables) return "ganada";
  if (ganadas) return "parcial";
  if (cotizables && perdidas === cotizables) return "perdida";
  if (emitida || items.some((i) => i.estado === "enviada_cliente")) return "con_cliente";
  return "cotizada";
}
