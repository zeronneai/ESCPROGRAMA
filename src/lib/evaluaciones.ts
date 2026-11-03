import { z } from "zod";

export interface EvalPeriodo {
  id: string;
  tipo: "proveedores" | "clientes";
  nombre: string;
  estado: "programado" | "activo" | "cerrado";
  programado_para: string | null;
  activado_at: string | null;
  cerrado_at: string | null;
  cierra_el?: string | null;
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

/** Escala del cliente (ESC-VEN-FR-002): 4 valores. */
export const ESCALA_CLIENTE = [
  { v: 1, label: "Insatisfecho", cls: "border-red-300 bg-red-50 text-red-800", bar: "bg-red-500" },
  { v: 2, label: "Poco satisfecho", cls: "border-orange-300 bg-orange-50 text-orange-900", bar: "bg-orange-400" },
  { v: 3, label: "Satisfecho", cls: "border-lime-400 bg-lime-50 text-lime-900", bar: "bg-lime-500" },
  { v: 4, label: "Muy satisfecho", cls: "border-green-400 bg-green-50 text-green-800", bar: "bg-green-600" },
] as const;

/** Escala anterior (encuestas contestadas antes de noviembre 2026). */
export const ESCALA_CLIENTE_3 = [
  { v: 1, label: "No satisfactorio", bar: "bg-red-500" },
  { v: 2, label: "Satisfactorio", bar: "bg-amber-400" },
  { v: 3, label: "Muy satisfactorio", bar: "bg-green-600" },
] as const;

export type RespuestaCliente = { respuestas: Record<string, number>; escala?: number | null };

/** Clasificacion del proveedor por puntaje (0 a 100). Rangos provisionales: se ajustan cuando ESC los defina. */
export function clasificacionProveedor(p: number | string | null): { label: string; cls: string } | null {
  if (p === null || p === undefined || p === "") return null;
  const n = Number(p);
  if (n >= 85) return { label: "Confiable", cls: "bg-green-100 text-green-800" };
  if (n >= 70) return { label: "Condicionado", cls: "bg-amber-100 text-amber-900" };
  return { label: "No confiable", cls: "bg-red-100 text-red-800" };
}

/**
 * Satisfaccion del cliente.
 * pct: % de respuestas Satisfecho o Muy satisfecho (en la escala anterior de 3: Satisfactorio o mas).
 * indice: 0 = todo en lo mas bajo, 100 = todo en lo mas alto.
 */
export function satisfaccion(rows: RespuestaCliente[]): { pct: number | null; indice: number | null } {
  let n = 0;
  let ok = 0;
  let idx = 0;
  for (const r of rows) {
    const esc = r.escala === 3 ? 3 : 4;
    for (const raw of Object.values(r.respuestas ?? {})) {
      const v = Number(raw);
      if (!v) continue;
      n++;
      if (v >= esc - 1) ok++;
      idx += (v - 1) / (esc - 1);
    }
  }
  if (!n) return { pct: null, indice: null };
  return { pct: Math.round((ok / n) * 100), indice: Math.round((idx / n) * 100) };
}

/** Estado del link de un cliente: sin enviar, enviada o recibida. */
export function encuestaEstado(e: { enviada_at: string | null; respondida_at: string | null } | null): "sin_enviar" | "enviada" | "recibida" {
  if (e?.respondida_at) return "recibida";
  if (e?.enviada_at) return "enviada";
  return "sin_enviar";
}
export const ENCUESTA_ESTADO = {
  sin_enviar: { label: "Sin enviar", cls: "bg-amber-100 text-amber-900" },
  enviada: { label: "Enviada", cls: "bg-sky-100 text-sky-800" },
  recibida: { label: "Recibida", cls: "bg-green-100 text-green-800" },
} as const;

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
