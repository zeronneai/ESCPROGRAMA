import { z } from "zod";

const date = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Fecha inválida");
const num = (max: number, msg: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s%]/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > max) {
        ctx.addIssue({ code: "custom", message: msg });
        return z.NEVER;
      }
      return Math.round(n * 100) / 100;
    });
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const bitacoraSchema = z
  .object({
    necesidad: text(1000),
    fecha_catalogo: date,
    fecha_muestra: date,
    muestra_no_aplica: z.boolean().optional().default(false),
    fecha_solicitud_compras: date,
    fecha_cotizacion: date,
    fecha_pedido: date,
    facturacion: z.enum(["contado", "credito"]).optional().nullable().transform((v) => v ?? null),
    fecha_factura: date,
    monto_venta: num(1e12, "Monto de venta inválido"),
    moneda: z.enum(["MXN", "USD"]).optional().default("MXN"),
    porcentaje_cobranza: num(100, "La cobranza va de 0 a 100%"),
    fecha_entrega: date,
    cartera_dias_vencidos: num(100000, "Días vencidos inválidos").transform((v) => (v === null ? null : Math.round(v))),
    cartera_monto: num(1e12, "Monto de cartera inválido"),
    comentarios: text(4000),
    proximo_seguimiento: date,
    request_id: z.string().uuid().optional().nullable().transform((v) => v ?? null),
    resultado: z.enum(["abierta", "ganada", "perdida"]).optional().default("abierta"),
    motivo_perdida: text(300),
  })
  .superRefine((v, ctx) => {
    if (v.resultado === "perdida" && !v.motivo_perdida) ctx.addIssue({ code: "custom", path: ["motivo_perdida"], message: "Indica por qué se perdió" });
  });
export type BitacoraInput = z.input<typeof bitacoraSchema>;

