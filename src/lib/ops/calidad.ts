import { z } from "zod";

export const VIAS = { telefono: "Teléfono", correo: "Correo", whatsapp: "WhatsApp", visita: "Visita", sitio_web: "Sitio web", otro: "Otro" } as const;
export type Via = keyof typeof VIAS;

export const QUEJA_ESTADOS = {
  abierta: { label: "Abierta", chip: "bg-amber-100 text-amber-900" },
  en_analisis: { label: "En análisis", chip: "bg-sky-100 text-sky-900" },
  con_sac: { label: "Con acción correctiva", chip: "bg-purple-100 text-purple-900" },
  cerrada: { label: "Cerrada", chip: "bg-green-100 text-green-800" },
} as const;
export type QuejaEstado = keyof typeof QUEJA_ESTADOS;

export const FUENTES = {
  revision_gerencial: "1. Revisiones gerenciales",
  queja_cliente: "2. Quejas de clientes",
  satisfaccion_cliente: "3. Satisfacción del cliente",
  auditoria: "4. Auditorías",
  requisito_legal: "5. Requisitos legales",
  producto_no_conforme: "6. Producto no conforme",
  simulacro: "7. Simulacros",
  otro: "8. Otros",
} as const;
export type Fuente = keyof typeof FUENTES;

export const SAC_ESTADOS = {
  abierta: { label: "Abierta", chip: "bg-amber-100 text-amber-900" },
  en_proceso: { label: "Plan en proceso", chip: "bg-sky-100 text-sky-900" },
  verificacion: { label: "En verificación", chip: "bg-indigo-100 text-indigo-900" },
  cerrada: { label: "Cerrada", chip: "bg-green-100 text-green-800" },
  cancelada: { label: "Cancelada", chip: "bg-slate-200 text-slate-700" },
} as const;
export type SacEstado = keyof typeof SAC_ESTADOS;

/** Las 6M del diagrama causa y efecto del formato. */
export const SEIS_M = [
  ["mano_obra", "Mano de obra"],
  ["material", "Material"],
  ["medio_ambiente", "Medio ambiente"],
  ["medicion", "Medición"],
  ["maquinaria", "Maquinaria"],
  ["metodo", "Método"],
] as const;

const txt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const optDate = z.union([date, z.literal(""), z.null()]).optional().transform((v) => v || null);

export const quejaSchema = z.object({
  fecha_recepcion: date,
  via_recepcion: z.enum(Object.keys(VIAS) as [Via, ...Via[]], { message: "Elige la vía de recepción" }),
  responsable_nombre: txt(120),
  customer_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  cliente_nombre: z.string().trim().min(2, "Escribe el cliente").max(200),
  contacto_nombre: txt(150),
  contacto_medio: txt(200),
  referencia: txt(200),
  descripcion: z.string().trim().min(5, "Describe el problema o queja").max(4000),
  vendedor_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
});
export type QuejaInput = z.input<typeof quejaSchema>;

const persona = z.object({ nombre: z.string().trim().max(150), puesto: z.string().trim().max(150) });
const actividad = z.object({
  actividad: z.string().trim().max(500),
  responsable: z.string().trim().max(150),
  fecha: z.string().max(10),
  reprogramacion: z.string().max(10),
  hecho: z.boolean(),
});
const verif = z.object({
  actividad: z.string().trim().max(500),
  auditor: z.string().trim().max(150),
  fecha: z.string().max(10),
  cumple: z.enum(["", "si", "no"]),
  evidencia: z.string().trim().max(300),
});
const triBool = z.union([z.boolean(), z.null()]).optional().transform((v) => v ?? null);

export const sacSchema = z
  .object({
    fecha: date,
    solicitante: z.string().trim().min(2, "Escribe el solicitante").max(150),
    codigo_control: txt(80),
    clausula: txt(80),
    fuente: z.enum(Object.keys(FUENTES) as [Fuente, ...Fuente[]], { message: "Elige la fuente" }),
    fuente_otro: txt(150),
    queja_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
    descripcion: z.string().trim().min(5, "Describe el problema real o potencial").max(4000),
    equipo: z.array(persona).max(10).transform((a) => a.filter((p) => p.nombre)),
    correccion: txt(2000),
    contencion: txt(2000),
    consecuencia: txt(2000),
    objetivo: txt(2000),
    causas: z.record(z.string(), z.string().max(1000)),
    causa_raiz: txt(2000),
    procesos_afectados: txt(1000),
    actualizar_riesgos: triBool,
    plan: z.array(actividad).max(20).transform((a) => a.filter((p) => p.actividad)),
    plan_crea_riesgo: triBool,
    plan_observaciones: txt(2000),
    verificacion: z.array(verif).max(20).transform((a) => a.filter((p) => p.actividad)),
    verificacion_observaciones: txt(2000),
    cumple_objetivo: triBool,
    alternativa: txt(2000),
    fecha_cierre: optDate,
    estado: z.enum(Object.keys(SAC_ESTADOS) as [SacEstado, ...SacEstado[]]),
  })
  .refine((v) => v.fuente !== "otro" || !!v.fuente_otro, { message: "Especifica la fuente (Otros)", path: ["fuente_otro"] });
export type SacInput = z.input<typeof sacSchema>;
export type SacPersona = z.infer<typeof persona>;
export type SacActividad = z.infer<typeof actividad>;
export type SacVerificacion = z.infer<typeof verif>;

export const CALIDAD_FILE_TYPES = [
  "application/pdf", "image/png", "image/jpeg", "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
