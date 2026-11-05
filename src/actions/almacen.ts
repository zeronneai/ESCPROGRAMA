"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { ALMACEN, SUBEN_FACTURA, type TipoRecepcion } from "@/lib/almacen";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();
const esAlmacen = (rol: string) => (ALMACEN as readonly string[]).includes(rol);

const recepcionSchema = z.object({
  tipo: z.enum(["compra", "inventario_inicial", "devolucion", "ajuste"]),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  orden_compra: z.string().trim().max(80).default(""),
  proveedor: z.string().trim().max(200).default(""),
  notas: z.string().trim().max(1000).default(""),
  lineas: z
    .array(z.object({ articulo_id: z.string().uuid(), cantidad: z.coerce.number().int("Cantidad entera").min(1, "Cantidad mínima 1").max(2000, "Máximo 2000 por renglón"), lote: z.string().trim().max(80).default("") }))
    .min(1, "Agrega al menos un artículo"),
});
export type RecepcionInput = z.input<typeof recepcionSchema> & { tipo: TipoRecepcion };

export async function crearRecepcionAction(input: RecepcionInput): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (!esAlmacen(u.rol)) return { ok: false, error: "Solo almacén registra recepciones." };
  const p = recepcionSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recepcion_crear", {
    p_tipo: p.data.tipo, p_fecha: p.data.fecha, p_orden_compra: p.data.orden_compra, p_proveedor: p.data.proveedor,
    p_notas: p.data.notas, p_lineas: p.data.lineas,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/almacen/recepciones");
  revalidatePath("/almacen/inventario");
  return { ok: true, id: data as string };
}

export async function bajaEtiquetaAction(codigo: string, motivo: string): Promise<Result> {
  const u = await requireUser();
  if (!esAlmacen(u.rol)) return { ok: false, error: "Solo almacén da de baja etiquetas." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("etiqueta_baja", { p_codigo: codigo, p_motivo: motivo });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/almacen/inventario");
  return { ok: true };
}

const lineaSalida = z.object({
  clave: z.string().trim().max(60).nullable(),
  descripcion: z.string().trim().max(500).default(""),
  unidad: z.string().trim().max(60).nullable().default(null),
  cantidad: z.coerce.number({ message: "Cantidad inválida" }).positive("Escribe la cantidad de cada partida").max(100000),
});
const salidaSchema = z.object({
  folio: z.string().trim().min(1, "Escribe el folio de la factura").max(40),
  fecha: z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().transform((v) => v || null),
  cliente: z.string().trim().max(300).default(""),
  vendedor: z.string().trim().max(150).default(""),
  notas: z.string().trim().max(1000).default(""),
  lineas: z.array(lineaSalida).min(1, "La factura no tiene artículos"),
});

/** Subir factura (PDF y/o XML) con lo que se leyo de ella, ya revisado por el usuario. */
export async function crearSalidaAction(fd: FormData): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (!(SUBEN_FACTURA as readonly string[]).includes(u.rol)) return { ok: false, error: "No puedes subir facturas." };
  let datos: unknown;
  try {
    datos = JSON.parse(String(fd.get("datos") ?? "{}"));
  } catch {
    return { ok: false, error: "Datos inválidos" };
  }
  const p = salidaSchema.safeParse(datos);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const carpeta = randomUUID();
  const subir = async (campo: string, tipos: string[]) => {
    const f = fd.get(campo);
    if (!(f instanceof File) || f.size === 0) return { path: null as string | null, nombre: null as string | null };
    if (f.size > 10 * 1024 * 1024) throw new Error("El archivo pesa más de 10 MB");
    const ct = f.type || (f.name.toLowerCase().endsWith(".xml") ? "text/xml" : "application/pdf");
    if (!tipos.includes(ct)) throw new Error(campo === "pdf" ? "La factura debe ser PDF" : "El XML no es válido");
    const path = `${carpeta}/${f.name.replace(/[^\w.\-]+/g, "_").slice(-80)}`;
    const { error } = await supabase.storage.from("facturas").upload(path, f, { contentType: ct });
    if (error) throw new Error(friendlyError(error.message));
    return { path, nombre: f.name.slice(0, 200) };
  };
  let pdf, xml;
  try {
    pdf = await subir("pdf", ["application/pdf"]);
    xml = await subir("xml", ["text/xml", "application/xml"]);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { data, error } = await supabase.rpc("salida_crear", {
    p_folio: p.data.folio, p_fecha: p.data.fecha, p_cliente: p.data.cliente, p_vendedor: p.data.vendedor, p_notas: p.data.notas,
    p_factura_path: pdf.path, p_factura_nombre: pdf.nombre ?? xml.nombre, p_xml_path: xml.path,
    p_lineas: p.data.lineas.map((l) => ({ ...l, cantidad: Math.ceil(l.cantidad) })),
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/entregas");
  return { ok: true, id: data as string };
}

export type Escaneo = { ok: boolean; mensaje?: string; codigo?: string | null; clave?: string; nombre?: string; escaneadas?: number; cantidad?: number; faltan?: number; aviso?: string | null };

export async function escanearAction(salidaId: string, codigo: string): Promise<Escaneo> {
  const u = await requireUser();
  if (!esAlmacen(u.rol)) return { ok: false, mensaje: "Solo almacén escanea la carga" };
  if (!uuid.safeParse(salidaId).success) return { ok: false, mensaje: "Entrega inválida" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("salida_escanear", { p_salida: salidaId, p_codigo: codigo.slice(0, 300) });
  if (error) return { ok: false, mensaje: friendlyError(error.message) };
  return data as Escaneo;
}

export async function quitarEscaneoAction(salidaId: string, codigo: string): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("salida_quitar", { p_salida: salidaId, p_codigo: codigo });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath(`/entregas/${salidaId}`);
  return { ok: true };
}

export async function terminarSalidaAction(salidaId: string, nota: string): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("salida_terminar", { p_salida: salidaId, p_nota: nota || null });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/entregas");
  revalidatePath(`/entregas/${salidaId}`);
  return { ok: true };
}

export async function cancelarSalidaAction(salidaId: string, motivo: string): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("salida_cancelar", { p_salida: salidaId, p_motivo: motivo });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/entregas");
  revalidatePath(`/entregas/${salidaId}`);
  return { ok: true };
}

/** Que claves ESC-... existen en el catalogo (para avisar antes de guardar). */
export async function verificarClavesAction(claves: string[]): Promise<Record<string, string>> {
  await requireUser();
  const list = [...new Set(claves.filter(Boolean).map((c) => c.toUpperCase().slice(0, 60)))].slice(0, 200);
  if (!list.length) return {};
  const supabase = await createClient();
  const { data } = await supabase.from("articulos").select("clave, nombre").in("clave", list);
  return Object.fromEntries((data ?? []).map((a) => [String(a.clave).toUpperCase(), a.nombre as string]));
}
