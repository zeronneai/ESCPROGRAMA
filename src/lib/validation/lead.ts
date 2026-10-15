import { z } from "zod";
import { ACTIVITY_KINDS, LEAD_SOURCES, LEAD_STAGES, PRIORITIES } from "@/lib/leads/types";

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .optional()
    .transform((v) => (v ? v : null));

export const leadSchema = z
  .object({
    empresa: z.string().trim().min(2, "Escribe el nombre de la empresa o prospecto").max(200),
    contacto_nombre: opt(150),
    contacto_puesto: opt(120),
    telefono: opt(40).refine((v) => !v || /^[\d\s()+\-.ext]{7,40}$/i.test(v), "Teléfono inválido"),
    correo: opt(200).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Correo inválido"),
    ciudad: opt(120),
    industria: opt(120),
    producto_interes: opt(500),
    origen: z.enum(LEAD_SOURCES),
    origen_detalle: opt(300),
    etapa: z.enum(LEAD_STAGES).default("nuevo"),
    prioridad: z.enum(PRIORITIES).default("media"),
    valor_estimado: z
      .string()
      .trim()
      .optional()
      .transform((v, ctx) => {
        if (!v) return null;
        const n = Number(v.replace(/[$,\s]/g, ""));
        if (!Number.isFinite(n) || n < 0) {
          ctx.addIssue({ code: "custom", message: "Valor estimado inválido" });
          return z.NEVER;
        }
        return Math.round(n * 100) / 100;
      }),
    moneda: z.enum(["MXN", "USD"]).default("MXN"),
    proximo_seguimiento: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Fecha inválida"),
    motivo_perdida: opt(300),
    notas: opt(4000),
  })
  .superRefine((v, ctx) => {
    if (v.etapa === "perdido" && !v.motivo_perdida) ctx.addIssue({ code: "custom", path: ["motivo_perdida"], message: "Indica por qué se perdió" });
    if (!v.telefono && !v.correo && !v.contacto_nombre) {
      ctx.addIssue({ code: "custom", path: ["telefono"], message: "Agrega al menos un contacto: nombre, teléfono o correo" });
    }
  });
export type LeadInput = z.input<typeof leadSchema>;
export type LeadData = z.output<typeof leadSchema>;

export const activitySchema = z.object({
  tipo: z.enum(ACTIVITY_KINDS),
  resultado: opt(120),
  nota: opt(2000),
  proximo_seguimiento: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Fecha inválida"),
});
export type ActivityInput = z.input<typeof activitySchema>;

export const stageSchema = z
  .object({ etapa: z.enum(LEAD_STAGES), motivo_perdida: opt(300) })
  .superRefine((v, ctx) => {
    if (v.etapa === "perdido" && !v.motivo_perdida) ctx.addIssue({ code: "custom", path: ["motivo_perdida"], message: "Indica por qué se perdió" });
  });

/** Lo que manda el formulario del sitio web (o cualquier integracion externa). */
export const webLeadSchema = z.object({
  empresa: z.string().trim().min(2).max(200),
  nombre: z.string().trim().max(150).optional(),
  puesto: z.string().trim().max(120).optional(),
  telefono: z.string().trim().max(40).optional(),
  correo: z.string().trim().max(200).optional(),
  ciudad: z.string().trim().max(120).optional(),
  industria: z.string().trim().max(120).optional(),
  producto: z.string().trim().max(500).optional(),
  mensaje: z.string().trim().max(2000).optional(),
  pagina: z.string().trim().max(300).optional(),
  externo_id: z.string().trim().max(120).optional(),
  /** Campo trampa anti-spam: si trae algo, se ignora el envio. */
  website: z.string().optional(),
});
