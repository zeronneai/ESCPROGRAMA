import type { IconName } from "@/components/icons";

export const LEAD_STAGES = ["nuevo", "contactado", "interesado", "cotizando", "negociacion", "ganado", "perdido"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
/** Etapas abiertas, en orden de avance (el embudo). */
export const OPEN_STAGES = ["nuevo", "contactado", "interesado", "cotizando", "negociacion"] as const satisfies readonly LeadStage[];

export const STAGE_LABEL: Record<LeadStage, string> = {
  nuevo: "Prospecto nuevo",
  contactado: "Contactado",
  interesado: "Interesado",
  cotizando: "Cotizando",
  negociacion: "Negociación",
  ganado: "Cliente (ganado)",
  perdido: "Perdido",
};
export const STAGE_SHORT: Record<LeadStage, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  interesado: "Interesado",
  cotizando: "Cotizando",
  negociacion: "Negociación",
  ganado: "Ganado",
  perdido: "Perdido",
};
export const STAGE_HINT: Record<LeadStage, string> = {
  nuevo: "Aún no lo contactas",
  contactado: "Ya hubo primer contacto",
  interesado: "Mostró interés en un producto",
  cotizando: "Se le está preparando o ya tiene cotización",
  negociacion: "Precio, condiciones o muestras en discusión",
  ganado: "Ya compró: es cliente",
  perdido: "No avanzó",
};
export const STAGE_TONE: Record<LeadStage, string> = {
  nuevo: "bg-slate-100 text-slate-700",
  contactado: "bg-sky-100 text-sky-800",
  interesado: "bg-indigo-100 text-indigo-800",
  cotizando: "bg-amber-100 text-amber-900",
  negociacion: "bg-orange-100 text-orange-800",
  ganado: "bg-green-100 text-green-800",
  perdido: "bg-red-100 text-red-700",
};

export const LEAD_SOURCES = [
  "llamada_fria",
  "referido",
  "sitio_web",
  "whatsapp",
  "correo",
  "redes_sociales",
  "expo_evento",
  "visita",
  "cliente_existente",
  "otro",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const SOURCE_LABEL: Record<LeadSource, string> = {
  llamada_fria: "Llamada en frío",
  referido: "Referido",
  sitio_web: "Sitio web",
  whatsapp: "WhatsApp",
  correo: "Correo",
  redes_sociales: "Redes sociales",
  expo_evento: "Expo / evento",
  visita: "Visita a planta",
  cliente_existente: "Cliente existente",
  otro: "Otro",
};

export const ACTIVITY_KINDS = ["llamada", "whatsapp", "correo", "visita", "reunion", "muestra", "cotizacion", "nota"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number] | "cambio_etapa";
/** Actividades que cuentan como contacto real con el prospecto. */
export const CONTACT_KINDS: readonly ActivityKind[] = ["llamada", "whatsapp", "correo", "visita", "reunion", "muestra", "cotizacion"];
export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  llamada: "Llamada",
  whatsapp: "WhatsApp",
  correo: "Correo",
  visita: "Visita",
  reunion: "Reunión",
  muestra: "Muestra enviada",
  cotizacion: "Cotización enviada",
  nota: "Nota",
  cambio_etapa: "Cambio de etapa",
};
export const ACTIVITY_ICON: Record<ActivityKind, IconName> = {
  llamada: "phone",
  whatsapp: "chat",
  correo: "mail",
  visita: "pin",
  reunion: "users",
  muestra: "truck",
  cotizacion: "note",
  nota: "note",
  cambio_etapa: "arrow",
};
/** Resultados sugeridos por tipo (el vendedor puede escribir otro). */
export const ACTIVITY_RESULTS: Partial<Record<ActivityKind, string[]>> = {
  llamada: ["Contestó", "No contestó", "Buzón de voz", "Pidió que llame después", "Número equivocado"],
  whatsapp: ["Respondió", "Sin respuesta", "Mensaje enviado"],
  correo: ["Respondió", "Sin respuesta", "Correo enviado", "Rebotó"],
  visita: ["Interesado", "Sin interés", "Pidió muestra", "Pidió cotización"],
  reunion: ["Interesado", "Sin interés", "Pidió cotización"],
};

export const PRIORITIES = ["alta", "media", "baja"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { alta: "Alta", media: "Media", baja: "Baja" };
export const PRIORITY_TONE: Record<Priority, string> = {
  alta: "bg-red-50 text-red-700 ring-1 ring-red-200",
  media: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
  baja: "bg-slate-50 text-slate-400 ring-1 ring-slate-100",
};

export const LOST_REASONS = [
  "Precio alto",
  "Ya tiene proveedor",
  "Sin presupuesto",
  "No responde",
  "Producto no disponible",
  "Tiempo de entrega",
  "Proyecto cancelado",
] as const;

export interface LeadRow {
  id: string;
  vendedor_id: string | null;
  empresa: string;
  contacto_nombre: string | null;
  contacto_puesto: string | null;
  telefono: string | null;
  correo: string | null;
  ciudad: string | null;
  industria: string | null;
  producto_interes: string | null;
  origen: LeadSource;
  origen_detalle: string | null;
  etapa: LeadStage;
  prioridad: Priority;
  valor_estimado: number | string | null;
  moneda: "MXN" | "USD";
  proximo_seguimiento: string | null;
  ultimo_contacto_at: string | null;
  motivo_perdida: string | null;
  notas: string | null;
  customer_id: string | null;
  etapa_at: string;
  ganado_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadActivityRow {
  id: string;
  lead_id: string;
  tipo: ActivityKind;
  resultado: string | null;
  nota: string | null;
  etapa_antes: LeadStage | null;
  etapa_despues: LeadStage | null;
  created_by: string | null;
  created_at: string;
}

export const isClosed = (s: LeadStage) => s === "ganado" || s === "perdido";

/** Telefono en formato para WhatsApp (Mexico por defecto: 52 + 10 digitos). */
export function whatsappNumber(tel: string | null): string | null {
  if (!tel) return null;
  const d = tel.replace(/\D/g, "");
  if (d.length === 10) return `52${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}
