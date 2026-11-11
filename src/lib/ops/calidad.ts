import { z } from "zod";

export const VIAS = { telefono: "Teléfono", correo: "Correo", whatsapp: "WhatsApp", visita: "Visita", sitio_web: "Sitio web", link: "Link de quejas", otro: "Otro" } as const;
export type Via = keyof typeof VIAS;
/** Vias que se eligen al capturar (el "Link de quejas" solo lo pone el formulario publico). */
export const VIAS_CAPTURA = Object.fromEntries(Object.entries(VIAS).filter(([k]) => k !== "link")) as Record<Exclude<Via, "link">, string>;

/** Link publico para que los clientes manden quejas (tarjetas, firmas de correo). */
export const QUEJAS_LINK_RUTA = "/quejas";

export const QUEJA_ESTADOS = {
  por_revisar: { label: "Por revisar", chip: "bg-orange-100 text-orange-900" },
  no_aplica: { label: "No aplica", chip: "bg-slate-200 text-slate-700" },
  abierta: { label: "Abierta", chip: "bg-amber-100 text-amber-900" },
  en_analisis: { label: "En análisis", chip: "bg-sky-100 text-sky-900" },
  con_sac: { label: "Con acción correctiva", chip: "bg-purple-100 text-purple-900" },
  cerrada: { label: "Cerrada", chip: "bg-green-100 text-green-800" },
} as const;
export type QuejaEstado = keyof typeof QUEJA_ESTADOS;
/** Estatus que el coordinador ISO mueve a mano (por revisar / no aplica se deciden con el boton Aplica / No aplica). */
export const QUEJA_ESTADOS_MANUALES = ["abierta", "en_analisis", "con_sac", "cerrada"] as const satisfies readonly QuejaEstado[];
/** Todavia no se decide si aplica (o no aplico): todo lo demas esta bloqueado. */
export const quejaBloqueada = (e: QuejaEstado) => e === "por_revisar" || e === "no_aplica";
/** Ya no esta pendiente: cerrada o no aplica. */
export const quejaTerminada = (e: QuejaEstado) => e === "cerrada" || e === "no_aplica";

/** Lo que manda el cliente desde el link publico. */
export const quejaLinkSchema = z.object({
  cliente_nombre: z.string().trim().min(2, "Escriba el nombre de su empresa").max(200),
  contacto_nombre: z.string().trim().min(2, "Escriba su nombre").max(150),
  contacto_medio: z.string().trim().min(5, "Escriba un teléfono o correo para contactarle").max(200),
  referencia: z.string().trim().max(200).optional().default(""),
  descripcion: z.string().trim().min(10, "Describa con más detalle el problema").max(4000),
});
export type QuejaLinkInput = z.input<typeof quejaLinkSchema>;

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

/** Clausulas de ISO 9001:2015 que mas aplican a una accion correctiva (se guarda el texto completo). */
export const CLAUSULAS_ISO = [
  "4.4 Sistema de gestión de la calidad y sus procesos",
  "5.1.2 Enfoque al cliente",
  "6.1 Acciones para abordar riesgos y oportunidades",
  "7.1.5 Recursos de seguimiento y medición",
  "7.2 Competencia",
  "7.5 Información documentada",
  "8.2.1 Comunicación con el cliente",
  "8.2.2 Requisitos de los productos y servicios",
  "8.4 Control de los proveedores externos",
  "8.5.1 Control de la provisión del servicio",
  "8.5.2 Identificación y trazabilidad",
  "8.5.4 Preservación",
  "8.5.5 Actividades posteriores a la entrega",
  "8.6 Liberación de los productos y servicios",
  "8.7 Control de las salidas no conformes",
  "9.1.2 Satisfacción del cliente",
  "9.2 Auditoría interna",
  "9.3 Revisión por la dirección",
  "10.2 No conformidad y acción correctiva",
] as const;
