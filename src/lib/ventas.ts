import { z } from "zod";

export interface VentaLinea {
  id: string | null;
  articulo_id: string | null;
  descripcion: string;
  cantidad: number | null;
  clave?: string | null;
}

export interface VentaRow {
  id: string;
  vendedor_id: string;
  customer_id: string;
  fecha: string;
  request_id: string | null;
  pedido: string | null;
  factura: string | null;
  monto: number | string | null;
  moneda: "MXN" | "USD";
  pago: "contado" | "credito";
  dias_credito: number | null;
  vence: string | null;
  entregado: boolean;
  fecha_entrega: string | null;
  porcentaje_cobrado: number | string;
  fecha_cobro: string | null;
  comentarios: string | null;
  origen: "vendedor" | "portal";
  cancelada_at: string | null;
  created_at: string;
  tipo: "venta" | "visita";
  motivo_no_venta: string | null;
}

/** Motivos por los que no se concreto la venta en una visita. */
export const MOTIVOS_NO_VENTA = [
  "Precio",
  "Ya tiene proveedor",
  "No tiene necesidad por ahora",
  "Sin presupuesto",
  "Tiempo de entrega",
  "No estaba el comprador",
  "Otro",
] as const;

export const VENTA_COLS =
  "id, vendedor_id, customer_id, fecha, request_id, pedido, factura, monto, moneda, pago, dias_credito, vence, entregado, fecha_entrega, porcentaje_cobrado, fecha_cobro, comentarios, origen, cancelada_at, created_at, tipo, motivo_no_venta";

/** Lo que falta por cobrar (0 si esta cobrada o cancelada). */
export function saldo(v: Pick<VentaRow, "monto" | "porcentaje_cobrado" | "cancelada_at">): number {
  if (v.cancelada_at) return 0;
  return Math.max(0, Number(v.monto ?? 0) * (1 - Number(v.porcentaje_cobrado) / 100));
}

/** Estado de cobro: cobrada, por cobrar (contado o credito al corriente) o vencida (credito pasado su plazo). */
export function cobroEstado(v: Pick<VentaRow, "monto" | "porcentaje_cobrado" | "cancelada_at" | "pago" | "vence">, today: string): "cobrada" | "por_cobrar" | "vencida" | "cancelada" {
  if (v.cancelada_at) return "cancelada";
  if (Number(v.porcentaje_cobrado) >= 100) return "cobrada";
  if (v.pago === "credito" && v.vence && v.vence < today) return "vencida";
  return "por_cobrar";
}

export function diasVencidos(v: Pick<VentaRow, "vence">, today: string): number {
  if (!v.vence) return 0;
  return Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${v.vence}T12:00:00Z`)) / 86_400_000));
}

const txt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const ventaSchema = z.object({
  tipo: z.enum(["venta", "visita"]).default("venta"),
  motivo_no_venta: txt(300),
  customer_id: z.string().uuid("Elige el cliente"),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  pedido: txt(80),
  factura: txt(80),
  monto: z.union([z.literal(""), z.null(), z.coerce.number({ message: "Monto inválido" }).min(0, "Monto inválido")]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  moneda: z.enum(["MXN", "USD"]),
  pago: z.enum(["contado", "credito"]),
  dias_credito: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(365)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  entregado: z.boolean(),
  porcentaje_cobrado: z.coerce.number({ message: "Cobranza inválida" }).min(0).max(100),
  comentarios: txt(2000),
}).superRefine((v, ctx) => {
  if (v.tipo === "visita" && !v.motivo_no_venta) ctx.addIssue({ code: "custom", path: ["motivo_no_venta"], message: "Elige por qué no se concretó la venta" });
});
export type VentaInput = z.input<typeof ventaSchema>;

export const lineaSchema = z.object({
  id: z.string().uuid().nullable(),
  articulo_id: z.string().uuid().nullable(),
  descripcion: z.string().trim().min(1, "Escribe el artículo").max(300),
  cantidad: z.union([z.null(), z.coerce.number().positive("Cantidad inválida").max(9_999_999)]),
});

export const money = (n: number, m = "MXN") => `$${n.toLocaleString("es-MX", { maximumFractionDigits: 0 })}${m === "USD" ? " USD" : ""}`;
