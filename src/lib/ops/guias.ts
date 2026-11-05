import { z } from "zod";

export const PAQUETERIAS = ["Paquete Express", "Estafeta", "Tinypack", "Porteo", "DHL", "Otra"] as const;
export type Paqueteria = (typeof PAQUETERIAS)[number];
export const SERVICIOS = { estandar: "Estándar", express: "Express", dia_siguiente: "Día siguiente", economico: "Económico / terrestre" } as const;
export type Servicio = keyof typeof SERVICIOS;

export const GUIA_ESTADOS = {
  solicitada: { label: "Solicitada", chip: "bg-amber-100 text-amber-900", step: 0 },
  en_proceso: { label: "Generando", chip: "bg-sky-100 text-sky-900", step: 1 },
  requiere_datos: { label: "Faltan datos", chip: "bg-red-100 text-red-800", step: 1 },
  lista: { label: "Lista", chip: "bg-green-100 text-green-800", step: 2 },
  cancelada: { label: "Cancelada", chip: "bg-slate-200 text-slate-700", step: -1 },
} as const;
export type GuiaEstado = keyof typeof GUIA_ESTADOS;

/** Titulo de la guia: factura, persona o negocio y paqueteria. */
export function guiaTitle(g: { factura: string; destinatario: string; paqueteria: string; paqueteria_otra?: string | null }) {
  return `${g.factura} · ${g.destinatario} · ${g.paqueteria === "Otra" ? g.paqueteria_otra || "Otra" : g.paqueteria}`;
}

/** Las guias se atienden rapido: alarma a la hora y alerta roja fuerte a las 2 horas. */
export const AMBAR_AFTER_HOURS = 1;
export const ALERT_AFTER_HOURS = 2;
export const REMIND_AFTER_HOURS = 1;

/** Horas que lleva pendiente (desde que se pidio o se corrigieron los datos). */
export function hoursPending(g: { estado: GuiaEstado; solicitada_at: string }, now: Date): number | null {
  if (g.estado !== "solicitada" && g.estado !== "en_proceso") return null;
  return (now.getTime() - new Date(g.solicitada_at).getTime()) / 3_600_000;
}

/** Alerta visual: ambar a la hora, roja (fuerte) a las 2 horas. */
export function guiaAlert(g: { estado: GuiaEstado; solicitada_at: string }, now: Date): "roja" | "ambar" | null {
  const h = hoursPending(g, now);
  if (h === null) return null;
  if (h >= ALERT_AFTER_HOURS) return "roja";
  if (h >= AMBAR_AFTER_HOURS) return "ambar";
  return null;
}

/** El vendedor puede recordar a partir de 1 hora y maximo una vez por hora. */
export function canRemind(g: { estado: GuiaEstado; solicitada_at: string; ultimo_recordatorio_at: string | null }, now: Date): { ok: boolean; reason?: string } {
  const h = hoursPending(g, now);
  if (h === null) return { ok: false, reason: "La guía ya no está pendiente" };
  if (h < REMIND_AFTER_HOURS) {
    const m = Math.ceil((REMIND_AFTER_HOURS - h) * 60);
    return { ok: false, reason: `Podrás recordar en ${m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`}` };
  }
  if (g.ultimo_recordatorio_at && now.getTime() - new Date(g.ultimo_recordatorio_at).getTime() < 3_600_000) {
    return { ok: false, reason: "Ya recordaste hace menos de una hora" };
  }
  return { ok: true };
}

export function elapsedText(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.floor(h)} h`;
  return `${Math.floor(h / 24)} días`;
}

const txt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const num = (msg: string) => z.union([z.literal(""), z.coerce.number({ message: msg }).positive(msg)]).optional().transform((v) => (v === "" || v === undefined ? null : v));

export const guiaSchema = z
  .object({
    factura: z.string().trim().min(1, "Escribe la factura").max(60),
    destinatario: z.string().trim().min(2, "Escribe la persona o negocio").max(200),
    paqueteria: z.enum(PAQUETERIAS, { message: "Elige la paquetería" }),
    paqueteria_otra: txt(80),
    servicio: z.enum(Object.keys(SERVICIOS) as [Servicio, ...Servicio[]]),
    customer_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
    contacto_nombre: txt(150),
    telefono: z.string().trim().min(7, "Escribe el teléfono de quien recibe").max(40),
    correo: z.union([z.literal(""), z.string().trim().email("Correo inválido").max(150)]).optional().transform((v) => v || null),
    calle_numero: z.string().trim().min(3, "Escribe calle y número").max(250),
    colonia: txt(150),
    cp: z.string().trim().regex(/^\d{5}$/, "El código postal es de 5 dígitos"),
    ciudad: z.string().trim().min(2, "Escribe la ciudad").max(120),
    estado_geo: z.string().trim().min(2, "Elige el estado").max(60),
    referencias: txt(300),
    empaque: z.enum(["bulto", "tarima"], { message: "Elige bulto o tarima" }).default("bulto"),
    bultos: z.coerce.number({ message: "Cantidad inválida" }).int("Cantidad entera").min(1, "Mínimo 1").max(999),
    peso_kg: z.coerce.number({ message: "Peso inválido" }).positive("Escribe el peso aproximado"),
    largo_cm: num("Medida inválida"),
    ancho_cm: num("Medida inválida"),
    alto_cm: num("Medida inválida"),
    contenido: txt(300),
    valor_declarado: z.union([z.literal(""), z.coerce.number({ message: "Valor inválido" }).min(0)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
    asegurar: z.boolean().default(false),
    urgente: z.boolean().default(false),
    notas: txt(1000),
  })
  .refine((v) => v.paqueteria !== "Otra" || !!v.paqueteria_otra, { message: "Escribe cuál paquetería", path: ["paqueteria_otra"] });
export type GuiaInput = z.input<typeof guiaSchema>;

export const GUIA_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg"];

/** "3 bultos", "1 tarima". */
export const empaqueLabel = (empaque: string | null | undefined, n: number) =>
  `${n} ${empaque === "tarima" ? (n === 1 ? "tarima" : "tarimas") : n === 1 ? "bulto" : "bultos"}`;
