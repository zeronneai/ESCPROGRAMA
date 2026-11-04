import { z } from "zod";

export const MONEDAS = ["USD", "MXN", "CNY", "EUR"] as const;
export type Moneda = (typeof MONEDAS)[number];
export type EstadoPago = "por_liberar" | "en_espera" | "liberado" | "pagado" | "cerrado";

export const ESTADO_PAGO: Record<EstadoPago, { label: string; cls: string; hint: string }> = {
  por_liberar: { label: "Por liberar", cls: "bg-slate-100 text-slate-700", hint: "Compras aún no lo libera para pago" },
  en_espera: { label: "En espera", cls: "bg-amber-100 text-amber-900", hint: "Detenido por compras (falta algo)" },
  liberado: { label: "Liberado para pago", cls: "bg-red-100 text-red-800", hint: "Listo para que el CEO pague" },
  pagado: { label: "Pagado", cls: "bg-sky-100 text-sky-800", hint: "Falta que compras descargue el comprobante" },
  cerrado: { label: "Pagado y enviado", cls: "bg-green-100 text-green-800", hint: "Comprobante descargado por compras" },
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
  suppliers?: { nombre: string; pais: string | null } | null;
}
export interface PagoRow {
  id: string;
  oc_id: string;
  tipo: "anticipo" | "factura";
  numero_factura: string | null;
  fecha_factura: string | null;
  monto: number | string | null;
  fecha_limite: string | null;
  notas: string | null;
  estado: EstadoPago;
  estado_nota: string | null;
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
export const OC_COLS = "id, supplier_id, numero, fecha, moneda, monto, descripcion, cerrada_at, created_at, suppliers(nombre, pais)";
export const PAGO_COLS =
  "id, oc_id, tipo, numero_factura, fecha_factura, monto, fecha_limite, notas, estado, estado_nota, factura_path, factura_nombre, liberado_at, pago_fecha, pago_monto, pago_referencia, pago_notas, comprobante_path, comprobante_nombre, pagado_at, pagado_nombre, cerrado_at, created_at";

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
});
export type OcInput = z.input<typeof ocSchema>;

export const pagoSchema = z.object({
  tipo: z.enum(["anticipo", "factura"]),
  numero_factura: txt(60),
  fecha_factura: fecha,
  monto,
  fecha_limite: fecha,
  notas: txt(1000),
});
export type PagoInput = z.input<typeof pagoSchema>;

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
  (p.estado === "liberado" || p.estado === "por_liberar" || p.estado === "en_espera") && !!p.fecha_limite && p.fecha_limite < today;
