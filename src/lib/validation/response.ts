import { parseNumber, UNIDADES } from "./request";

export const MONEDAS = ["MXN", "USD"] as const;

/** Valores crudos del formulario del comprador (todo texto). */
export interface QuoteFormValues {
  costo: string;
  envio: string;
  moneda: string;
  entregaModo: "dias" | "fecha";
  entregaDias: string;
  entregaTipo: string;
  entregaFecha: string;
  minModo: "ninguna" | "cantidad" | "monto";
  minCantidad: string;
  minUnidad: string;
  minMonto: string;
  proveedor: string;
  nota: string;
  /** "El precio corresponde a": producto solicitado (default) o alternativo. */
  precioDe: "solicitado" | "alternativo";
  altNombre: string;
  altDescripcion: string;
  altMotivo: string;
}

export const ALT_NOMBRE_MAX = 200;
export const ALT_DESCRIPCION_MAX = 500;
export const ALT_MOTIVO_MAX = 1000;

export interface AlternativeInput {
  nombre: string;
  descripcion: string | null;
  motivo: string;
}

export interface QuoteInput {
  costo: number;
  envio: number | null;
  moneda: "MXN" | "USD";
  entrega: { dias: number | null; tipo: "habiles" | "naturales" | null; fecha: string | null };
  compra_min: { cantidad: number | null; unidad: string | null; monto: number | null };
  proveedor: string | null;
  nota: string | null;
  /** null = el precio es del producto solicitado. */
  alternativo: AlternativeInput | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

export const emptyQuoteForm: QuoteFormValues = {
  costo: "",
  envio: "",
  moneda: "MXN",
  entregaModo: "dias",
  entregaDias: "",
  entregaTipo: "habiles",
  entregaFecha: "",
  minModo: "ninguna",
  minCantidad: "",
  minUnidad: "pieza",
  minMonto: "",
  proveedor: "",
  nota: "",
  precioDe: "solicitado",
  altNombre: "",
  altDescripcion: "",
  altMotivo: "",
};

export function parseQuoteForm(v: QuoteFormValues): Parsed<QuoteInput> {
  const errors: Record<string, string> = {};

  const costo = parseNumber(v.costo);
  if (costo === undefined) errors.costo = "Captura el costo";
  else if (Number.isNaN(costo) || costo <= 0) errors.costo = "El costo debe ser mayor a 0";

  const envio = parseNumber(v.envio);
  if (envio !== undefined && (Number.isNaN(envio) || envio < 0)) errors.envio = "Envio invalido";

  if (!(MONEDAS as readonly string[]).includes(v.moneda)) errors.moneda = "Elige la moneda";

  const entrega: QuoteInput["entrega"] = { dias: null, tipo: null, fecha: null };
  if (v.entregaModo === "dias") {
    const d = parseNumber(v.entregaDias);
    if (d === undefined || Number.isNaN(d) || d < 0 || !Number.isInteger(d)) {
      errors.entregaDias = "Captura los dias de entrega (numero entero)";
    } else entrega.dias = d;
    if (v.entregaTipo !== "habiles" && v.entregaTipo !== "naturales") errors.entregaTipo = "Elige habiles o naturales";
    else entrega.tipo = v.entregaTipo;
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(v.entregaFecha)) {
    errors.entregaFecha = "Captura la fecha estimada";
  } else entrega.fecha = v.entregaFecha;

  const min: QuoteInput["compra_min"] = { cantidad: null, unidad: null, monto: null };
  if (v.minModo === "cantidad") {
    const c = parseNumber(v.minCantidad);
    if (c === undefined || Number.isNaN(c) || c <= 0) errors.minCantidad = "Captura la cantidad minima";
    else min.cantidad = c;
    if (!(UNIDADES as readonly string[]).includes(v.minUnidad)) errors.minUnidad = "Elige la unidad";
    else min.unidad = v.minUnidad;
  } else if (v.minModo === "monto") {
    const m = parseNumber(v.minMonto);
    if (m === undefined || Number.isNaN(m) || m <= 0) errors.minMonto = "Captura el monto minimo";
    else min.monto = m;
  }

  let alternativo: AlternativeInput | null = null;
  if (v.precioDe === "alternativo") {
    const nombre = v.altNombre.trim();
    const motivo = v.altMotivo.trim();
    const descripcion = v.altDescripcion.trim();
    if (!nombre) errors.altNombre = "Captura el nombre del producto alternativo";
    else if (nombre.length > ALT_NOMBRE_MAX) errors.altNombre = `El nombre no puede pasar de ${ALT_NOMBRE_MAX} caracteres`;
    if (!motivo) errors.altMotivo = "Explica por que sirve para lo mismo";
    else if (motivo.length > ALT_MOTIVO_MAX) errors.altMotivo = `La nota no puede pasar de ${ALT_MOTIVO_MAX} caracteres`;
    if (descripcion.length > ALT_DESCRIPCION_MAX) errors.altDescripcion = `La presentacion no puede pasar de ${ALT_DESCRIPCION_MAX} caracteres`;
    if (!errors.altNombre && !errors.altMotivo && !errors.altDescripcion) alternativo = { nombre, descripcion: descripcion || null, motivo };
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      costo: costo!,
      envio: envio && envio > 0 ? envio : null,
      moneda: v.moneda as "MXN" | "USD",
      entrega,
      compra_min: min,
      proveedor: v.proveedor.trim() || null,
      nota: v.nota.trim() || null,
      alternativo,
    },
  };
}

export function parseNotFoundNote(nota: string): Parsed<{ nota: string }> {
  const t = nota.trim();
  if (!t) return { ok: false, errors: { nota: "La nota es obligatoria: explica por que no se encontro" } };
  return { ok: true, value: { nota: t } };
}
