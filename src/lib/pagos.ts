import { z } from "zod";

export const MONEDAS = ["USD", "MXN", "CNY", "EUR"] as const;
export type Moneda = (typeof MONEDAS)[number];
export type EstadoPago = "pendiente" | "pagado" | "cerrado";
export type Carga = "sin_liberar" | "liberada";

export const ESTADO_PAGO: Record<EstadoPago, { label: string; cls: string; hint: string }> = {
  pendiente: { label: "Por pagar", cls: "bg-red-100 text-red-800", hint: "Pendiente de pago" },
  pagado: { label: "Pagado", cls: "bg-sky-100 text-sky-800", hint: "Falta que compras descargue el comprobante" },
  cerrado: { label: "Pagado y enviado", cls: "bg-green-100 text-green-800", hint: "Comprobante descargado por compras" },
};
/** Seguimiento de la importacion: si el proveedor ya libero la carga (no depende del pago). */
export const CARGA: Record<Carga, { label: string; cls: string }> = {
  sin_liberar: { label: "Carga sin liberar", cls: "bg-amber-100 text-amber-900" },
  liberada: { label: "Carga liberada", cls: "bg-green-100 text-green-800" },
};
export const TIPO_PAGO = { anticipo: "Anticipo", factura: "Factura" } as const;

export interface OcRow {
  id: string;
  supplier_id: string;
  numero: string;
  fecha: string;
  moneda: Moneda;
  monto: number | string | null;
  descripcion: string | null;
  cerrada_at: string | null;
  created_at: string;
  proforma_numero?: string | null;
  proforma_fecha?: string | null;
  proforma_monto?: number | string | null;
  proforma_path?: string | null;
  proforma_nombre?: string | null;
  suppliers?: { nombre: string; pais: string | null } | null;
}
export interface PagoRow {
  id: string;
  oc_id: string;
  tipo: "anticipo" | "factura";
  numero_factura: string | null;
  fecha_factura: string | null;
  monto: number | string | null;
  anticipo_aplicado?: number | string | null;
  fecha_limite: string | null;
  notas: string | null;
  estado: EstadoPago;
  estado_nota: string | null;
  carga: Carga;
  carga_at: string | null;
  urgente: boolean;
  factura_path: string | null;
  factura_nombre: string | null;
  liberado_at: string | null;
  pago_fecha: string | null;
  pago_monto: number | string | null;
  pago_referencia: string | null;
  pago_notas: string | null;
  comprobante_path: string | null;
  comprobante_nombre: string | null;
  pagado_at: string | null;
  pagado_nombre: string | null;
  cerrado_at: string | null;
  created_at: string;
}
export const OC_COLS =
  "id, supplier_id, numero, fecha, moneda, monto, descripcion, cerrada_at, created_at, proforma_numero, proforma_fecha, proforma_monto, proforma_path, proforma_nombre, suppliers(nombre, pais)";
export const PAGO_COLS =
  "id, oc_id, tipo, numero_factura, fecha_factura, monto, anticipo_aplicado, fecha_limite, notas, estado, estado_nota, carga, carga_at, urgente, factura_path, factura_nombre, liberado_at, pago_fecha, pago_monto, pago_referencia, pago_notas, comprobante_path, comprobante_nombre, pagado_at, pagado_nombre, cerrado_at, created_at";

const txt = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`).optional().nullable().transform((v) => v || null);
const fecha = z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")]).optional().transform((v) => v || null);
const monto = z
  .union([z.literal(""), z.null(), z.coerce.number({ message: "Monto inválido" }).positive("El monto debe ser mayor a 0").max(999_999_999)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

export const ocSchema = z.object({
  supplier_id: z.string().uuid("Elige el proveedor"),
  numero: z.string().trim().min(1, "Escribe el número de la OC").max(60),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  moneda: z.enum(MONEDAS),
  monto,
  descripcion: txt(1000),
  proforma_numero: txt(60).optional(),
  proforma_fecha: fecha.optional(),
  proforma_monto: monto.optional(),
});
export type OcInput = z.input<typeof ocSchema>;

export const pagoSchema = z.object({
  tipo: z.enum(["anticipo", "factura"]),
  numero_factura: txt(60),
  fecha_factura: fecha,
  monto,
  fecha_limite: fecha,
  notas: txt(1000),
  /** Factura: cuanto del anticipo ya pagado se descuenta de esta factura. */
  anticipo_aplicado: z.union([z.literal(""), z.null(), z.coerce.number().min(0, "Anticipo inválido").max(999_999_999)]).optional().transform((v) => (v === "" || v == null ? 0 : v)),
});
export type PagoInput = z.input<typeof pagoSchema>;

/** Lo que falta pagar de una factura o anticipo: su monto menos el anticipo que se le descuenta. */
export const netoPago = (p: { monto: number | string | null; anticipo_aplicado?: number | string | null }) =>
  p.monto == null || p.monto === "" ? null : Math.round((Number(p.monto) - Number(p.anticipo_aplicado ?? 0)) * 100) / 100;

export const fmtMonto = (n: number | string | null | undefined, moneda: string) =>
  n === null || n === undefined || n === "" ? "Sin monto" : `${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda}`;

/** Suma por moneda: { USD: 1500, CNY: 20000 }. */
export function totalesPorMoneda(rows: { monto: number | string | null; moneda: string }[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const r of rows) if (r.monto !== null && r.monto !== "") t[r.moneda] = (t[r.moneda] ?? 0) + Number(r.monto);
  return t;
}
export const fmtTotales = (t: Record<string, number>) =>
  Object.keys(t).length ? Object.entries(t).map(([m, n]) => fmtMonto(n, m)).join(" + ") : "Sin monto todavía";

/** Pendientes: lo que aun no se archiva. */
export const pagoPendiente = (p: Pick<PagoRow, "estado">) => p.estado !== "cerrado";
export const pagoVencido = (p: Pick<PagoRow, "estado" | "fecha_limite">, today: string) =>
  p.estado === "pendiente" && !!p.fecha_limite && p.fecha_limite < today;

/** Orden para el CEO: urgente, vencido, carga sin liberar y luego por fecha limite. */
export function prioridadPago(p: Pick<PagoRow, "estado" | "fecha_limite" | "urgente" | "carga">, today: string): number {
  if (p.estado !== "pendiente") return 9;
  if (p.urgente) return 0;
  if (pagoVencido(p, today)) return 1;
  if (p.carga === "sin_liberar") return 2;
  return 3;
}
export const ordenPagos = <T extends Pick<PagoRow, "estado" | "fecha_limite" | "urgente" | "carga" | "created_at">>(l: T[], today: string) =>
  [...l].sort((a, b) => prioridadPago(a, today) - prioridadPago(b, today) || (a.fecha_limite ?? "9999").localeCompare(b.fecha_limite ?? "9999") || a.created_at.localeCompare(b.created_at));

/** Proveedores para elegir en la OC: primero los que ya estan en pagos, luego extranjeros y el resto. */
export const ordenarProvs = <T extends { nombre: string; en_pagos?: boolean; tipo?: string }>(l: T[]) =>
  [...l].sort((a, b) => Number(!!b.en_pagos) - Number(!!a.en_pagos) || Number(b.tipo === "extranjero") - Number(a.tipo === "extranjero") || a.nombre.localeCompare(b.nombre));
