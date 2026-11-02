import { z } from "zod";

export interface EvalPeriodo {
  id: string;
  tipo: "proveedores" | "clientes";
  nombre: string;
  estado: "programado" | "activo" | "cerrado";
  programado_para: string | null;
  activado_at: string | null;
  cerrado_at: string | null;
}
export interface Pregunta {
  id: string;
  tipo: "proveedor" | "cliente";
  responsable: "comprador" | "almacen" | "cliente";
  orden: number;
  texto: string;
  ayuda: string | null;
}

/** Escala del proveedor (1 a 5). */
export const ESCALA_PROVEEDOR = [
  { v: 1, label: "Malo" },
  { v: 2, label: "Regular" },
  { v: 3, label: "Bueno" },
  { v: 4, label: "Muy bueno" },
  { v: 5, label: "Excelente" },
] as const;

/** Escala del cliente (3 valores). */
export const ESCALA_CLIENTE = [
  { v: 1, label: "No satisfactorio", cls: "border-red-300 bg-red-50 text-red-800" },
  { v: 2, label: "Satisfactorio", cls: "border-amber-300 bg-amber-50 text-amber-900" },
  { v: 3, label: "Muy satisfactorio", cls: "border-green-400 bg-green-50 text-green-800" },
] as const;

/** Clasificacion del proveedor por puntaje (0 a 100). Rangos provisionales: se ajustan cuando ESC los defina. */
export function clasificacionProveedor(p: number | string | null): { label: string; cls: string } | null {
  if (p === null || p === undefined || p === "") return null;
  const n = Number(p);
  if (n >= 85) return { label: "Confiable", cls: "bg-green-100 text-green-800" };
  if (n >= 70) return { label: "Condicionado", cls: "bg-amber-100 text-amber-900" };
  return { label: "No confiable", cls: "bg-red-100 text-red-800" };
}

/** Satisfaccion del cliente: % de respuestas Satisfactorio o Muy satisfactorio. */
export function satisfaccion(resps: Record<string, number>[]): { pct: number | null; indice: number | null } {
  const vals = resps.flatMap((r) => Object.values(r).map(Number));
  if (!vals.length) return { pct: null, indice: null };
  return {
    pct: Math.round((vals.filter((v) => v >= 2).length / vals.length) * 100),
    indice: Math.round(((vals.reduce((a, v) => a + v, 0) / vals.length - 1) / 2) * 100),
  };
}

export const supplierSchema = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre").max(200),
  razon_social: z.string().trim().max(200).optional().transform((v) => v || null),
  rfc: z.string().trim().max(20).optional().transform((v) => v || null),
  tipo: z.enum(["nacional", "extranjero"]),
  pais: z.string().trim().max(60).optional().transform((v) => v || null),
  giro: z.string().trim().max(200).optional().transform((v) => v || null),
  contacto_nombre: z.string().trim().max(150).optional().transform((v) => v || null),
  telefono: z.string().trim().max(40).optional().transform((v) => v || null),
  correo: z.union([z.literal(""), z.string().trim().email("Correo inválido").max(150)]).optional().transform((v) => v || null),
  direccion: z.string().trim().max(300).optional().transform((v) => v || null),
  sitio_web: z.string().trim().max(200).optional().transform((v) => v || null),
  condiciones_pago: z.string().trim().max(150).optional().transform((v) => v || null),
  notas: z.string().trim().max(1000).optional().transform((v) => v || null),
  evaluar: z.boolean(),
});
export type SupplierInput = z.input<typeof supplierSchema>;
export interface SupplierRow {
  id: string;
  nombre: string;
  activo: boolean;
  razon_social: string | null;
  rfc: string | null;
  tipo: "nacional" | "extranjero";
  pais: string | null;
  giro: string | null;
  contacto_nombre: string | null;
  telefono: string | null;
  correo: string | null;
  direccion: string | null;
  sitio_web: string | null;
  condiciones_pago: string | null;
  notas: string | null;
  evaluar: boolean;
  created_at: string;
}
export const SUPPLIER_COLS = "id, nombre, activo, razon_social, rfc, tipo, pais, giro, contacto_nombre, telefono, correo, direccion, sitio_web, condiciones_pago, notas, evaluar, created_at";

/** Link publico de la encuesta. */
export const encuestaUrl = (origin: string, token: string) => `${origin.replace(/\/$/, "")}/encuesta/${token}`;
