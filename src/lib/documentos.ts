import { z } from "zod";

export const CATEGORIAS_DOC = ["Política", "Valores", "Manual", "Procedimiento", "Instructivo", "Formato", "Organigrama", "Registro", "Otro"] as const;
export type CategoriaDoc = (typeof CATEGORIAS_DOC)[number];

export interface DocumentoRow {
  id: string;
  codigo: string | null;
  titulo: string;
  categoria: CategoriaDoc;
  version: string;
  fecha_emision: string;
  descripcion: string | null;
  nombre_archivo: string;
  tamano: number | null;
  vigente: boolean;
  reemplaza_id: string | null;
  baja_at: string | null;
  baja_motivo: string | null;
  autor_nombre: string | null;
  created_at: string;
}
export const DOC_COLS = "id, codigo, titulo, categoria, version, fecha_emision, descripcion, nombre_archivo, tamano, vigente, reemplaza_id, baja_at, baja_motivo, autor_nombre, created_at";

const txt = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`).optional().transform((v) => v || null);

export const documentoSchema = z.object({
  codigo: txt(40).transform((v) => (v ? v.toUpperCase() : null)),
  titulo: z.string().trim().min(2, "Escribe el título del documento").max(200),
  categoria: z.enum(CATEGORIAS_DOC, { message: "Elige la categoría" }),
  version: z.string().trim().min(1, "Escribe la versión").max(20),
  fecha_emision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  descripcion: txt(1000),
});
export type DocumentoInput = z.input<typeof documentoSchema>;

export const MAX_DOC_BYTES = 10 * 1024 * 1024;
export const pesoArchivo = (b: number | null) => (!b ? "" : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Control de cambios (version base; se ajusta cuando ESC tenga su formato). */
export const TIPOS_CAMBIO = { alta: "Alta (documento nuevo)", modificacion: "Modificación", baja: "Baja (se deja de usar)" } as const;
export const ESTADOS_CAMBIO = {
  en_proceso: { label: "En proceso", cls: "bg-amber-100 text-amber-900" },
  implementado: { label: "Implementado", cls: "bg-green-100 text-green-800" },
  cancelado: { label: "Cancelado", cls: "bg-slate-200 text-slate-700" },
} as const;
export type TipoCambio = keyof typeof TIPOS_CAMBIO;
export type EstadoCambio = keyof typeof ESTADOS_CAMBIO;

export interface CambioRow {
  id: string;
  numero: string;
  fecha: string;
  tipo: TipoCambio;
  documento_id: string | null;
  documento_texto: string | null;
  area: string | null;
  descripcion: string;
  motivo: string;
  version_anterior: string | null;
  version_nueva: string | null;
  solicitado_por: string | null;
  aprobado_por: string | null;
  fecha_implementacion: string | null;
  estado: EstadoCambio;
  notas: string | null;
  autor_nombre: string | null;
  created_at: string;
  documentos?: { codigo: string | null; titulo: string; version: string } | null;
}
export const CAMBIO_COLS =
  "id, numero, fecha, tipo, documento_id, documento_texto, area, descripcion, motivo, version_anterior, version_nueva, solicitado_por, aprobado_por, fecha_implementacion, estado, notas, autor_nombre, created_at, documentos(codigo, titulo, version)";

const fechaOpt = z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")]).optional().transform((v) => v || null);

export const cambioSchema = z
  .object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
    tipo: z.enum(["alta", "modificacion", "baja"]),
    documento_id: z.union([z.literal(""), z.null(), z.string().uuid()]).optional().transform((v) => v || null),
    documento_texto: txt(200),
    area: txt(120),
    descripcion: z.string().trim().min(3, "Describe el cambio").max(3000),
    motivo: z.string().trim().min(3, "Escribe el motivo del cambio").max(2000),
    version_anterior: txt(20),
    version_nueva: txt(20),
    solicitado_por: txt(150),
    aprobado_por: txt(150),
    fecha_implementacion: fechaOpt,
    estado: z.enum(["en_proceso", "implementado", "cancelado"]),
    notas: txt(2000),
  })
  .refine((v) => v.documento_id || v.documento_texto, { message: "Elige el documento o escribe a qué se refiere el cambio", path: ["documento_texto"] });
export type CambioInput = z.input<typeof cambioSchema>;

export const docNombre = (d: { codigo: string | null; titulo: string } | null | undefined, texto?: string | null) =>
  d ? `${d.codigo ? `${d.codigo} ` : ""}${d.titulo}` : texto ?? "";
