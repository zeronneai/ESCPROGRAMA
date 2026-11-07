"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { MONEDAS, ocSchema, pagoSchema, type OcInput, type PagoInput } from "@/lib/pagos";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", XLSX, "application/vnd.ms-excel", DOCX, "application/msword"];
const MAX = 10 * 1024 * 1024;
const refresh = (ocId?: string | null) => {
  revalidatePath("/pagos");
  if (ocId) revalidatePath(`/pagos/oc/${ocId}`);
};
async function rol(r: "comprador" | "ceo") {
  const u = await requireUser();
  return u.rol === r ? u : null;
}
const POR_EXT: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", xlsx: XLSX, xls: "application/vnd.ms-excel", docx: DOCX, doc: "application/msword" };
function archivo(fd: FormData): File | string | null {
  let file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  // Algunos equipos mandan el archivo sin tipo: se toma de la extension.
  if (!FILE_TYPES.includes(file.type)) {
    const t = POR_EXT[file.name.split(".").pop()?.toLowerCase() ?? ""];
    if (t) file = new File([file], file.name, { type: t });
  }
  if (!FILE_TYPES.includes(file.type)) return "Solo PDF, Excel, Word o imagen (PNG, JPG)";
  if (file.size > MAX) return "El archivo pesa más de 10 MB";
  return file;
}
async function subir(pagoId: string, file: File, prefijo: string): Promise<{ path: string } | { error: string }> {
  const supabase = await createClient();
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${pagoId}/${prefijo}-${randomUUID().slice(0, 6)}-${safe}`;
  const { error } = await supabase.storage.from("pagos").upload(path, file, { contentType: file.type });
  return error ? { error: friendlyError(error.message) } : { path };
}

/** Comprador: agregar o quitar un proveedor de la seccion de pagos. */
export async function proveedorPagosAction(id: string, en_pagos: boolean, moneda?: string): Promise<Result> {
  if (!(await rol("comprador"))) return { ok: false, error: "Solo el comprador elige los proveedores." };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Proveedor inválido" };
  const patch: Record<string, unknown> = { en_pagos };
  if (moneda && (MONEDAS as readonly string[]).includes(moneda)) patch.pagos_moneda = moneda;
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update(patch).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh();
  return { ok: true };
}

/** Comprador: alta o edicion de la OC; en el alta puede traer sus facturas o anticipos. */
export async function saveOcAction(id: string | null, input: OcInput, lineas: PagoInput[] = []): Promise<Result<{ id: string; pagos?: string[] }>> {
  if (!(await rol("comprador"))) return { ok: false, error: "Solo el comprador registra órdenes de compra." };
  const parsed = ocSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const ls = z.array(pagoSchema).max(50).safeParse(lineas);
  if (!ls.success) return { ok: false, error: ls.error.issues[0].message };
  // Los datos de la proforma solo se tocan si vienen (editar la OC no los borra).
  for (const k of ["proforma_numero", "proforma_fecha", "proforma_monto"] as const) if (!(k in input)) delete (parsed.data as Record<string, unknown>)[k];
  const supabase = await createClient();
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "OC inválida" };
    const { supplier_id: _s, ...upd } = parsed.data;
    void _s;
    const { data, error } = await supabase.from("ordenes_compra").update(upd).eq("id", id).select("id");
    if (error) return { ok: false, error: /duplicate/i.test(error.message) ? "Ese proveedor ya tiene una OC con ese número." : friendlyError(error.message) };
    if (!data?.length) return { ok: false, error: "No se pudo guardar." };
    refresh(id);
    return { ok: true, id };
  }
  const { data, error } = await supabase.from("ordenes_compra").insert(parsed.data).select("id").single();
  if (error) return { ok: false, error: /duplicate/i.test(error.message) ? "Ese proveedor ya tiene una OC con ese número." : friendlyError(error.message) };
  const rows = ls.data.filter((l) => l.numero_factura || l.monto).map((l) => ({ ...l, oc_id: data.id }));
  let pagos: string[] = [];
  if (rows.length) {
    const { data: ins, error: e2 } = await supabase.from("pagos").insert(rows).select("id");
    if (e2) return { ok: false, error: friendlyError(e2.message) };
    pagos = (ins ?? []).map((r) => r.id as string);
  }
  refresh(data.id);
  return { ok: true, id: data.id, pagos };
}

export async function ocCerrarAction(id: string, cerrar: boolean): Promise<Result> {
  if (!(await rol("comprador"))) return { ok: false, error: "No autorizado" };
  if (!uuid.safeParse(id).success) return { ok: false, error: "OC inválida" };
  const supabase = await createClient();
  const { error } = await supabase.from("ordenes_compra").update({ cerrada_at: cerrar ? new Date().toISOString() : null }).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

export async function deleteOcAction(id: string): Promise<Result> {
  if (!(await rol("comprador"))) return { ok: false, error: "No autorizado" };
  if (!uuid.safeParse(id).success) return { ok: false, error: "OC inválida" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("ordenes_compra").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "Primero borra sus facturas o anticipos." };
  refresh();
  return { ok: true };
}

/** Comprador: subir (o reemplazar) el documento de la proforma de la OC, con sus datos. */
export async function proformaArchivoAction(fd: FormData): Promise<Result> {
  if (!(await rol("comprador"))) return { ok: false, error: "No autorizado" };
  const ocId = String(fd.get("oc") ?? "");
  if (!uuid.safeParse(ocId).success) return { ok: false, error: "OC inválida" };
  const f = archivo(fd);
  if (typeof f === "string") return { ok: false, error: f };
  const datos = ocSchema.pick({ proforma_numero: true, proforma_fecha: true, proforma_monto: true }).safeParse({
    proforma_numero: fd.get("numero") ?? undefined,
    proforma_fecha: fd.get("fecha") ?? undefined,
    proforma_monto: fd.get("monto") ?? undefined,
  });
  if (!datos.success) return { ok: false, error: datos.error.issues[0].message };
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(datos.data)) if (fd.has(k.replace("proforma_", ""))) patch[k] = v;
  if (f) {
    const up = await subir(ocId, f, "proforma");
    if ("error" in up) return { ok: false, error: up.error };
    patch.proforma_path = up.path;
    patch.proforma_nombre = f.name.slice(0, 200);
  }
  // Si cambio el total de la proforma, tambien se puede actualizar el total de la OC.
  if (fd.get("actualizar_oc") === "1" && typeof patch.proforma_monto === "number") patch.monto = patch.proforma_monto;
  if (!Object.keys(patch).length) return { ok: false, error: "Nada que guardar" };
  const supabase = await createClient();
  const { error } = await supabase.from("ordenes_compra").update(patch).eq("id", ocId);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(ocId);
  return { ok: true };
}

/** Comprador: quitar la proforma de la OC (documento y datos). */
export async function quitarProformaAction(ocId: string): Promise<Result> {
  if (!(await rol("comprador"))) return { ok: false, error: "No autorizado" };
  if (!uuid.safeParse(ocId).success) return { ok: false, error: "OC inválida" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("ordenes_compra")
    .update({ proforma_numero: null, proforma_fecha: null, proforma_monto: null, proforma_path: null, proforma_nombre: null })
    .eq("id", ocId);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(ocId);
  return { ok: true };
}

/** Comprador: alta o edicion de una factura o anticipo de la OC (numero y monto se pueden completar despues). */
export async function savePagoAction(id: string | null, ocId: string, input: PagoInput): Promise<Result<{ id: string }>> {
  if (!(await rol("comprador"))) return { ok: false, error: "Solo el comprador captura facturas." };
  if (!uuid.safeParse(ocId).success) return { ok: false, error: "OC inválida" };
  const parsed = pagoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Pago inválido" };
    const { data: cur } = await supabase.from("pagos").select("estado, monto").eq("id", id).maybeSingle();
    const patch: Record<string, unknown> = { ...parsed.data };
    if (cur && (cur.estado === "pagado" || cur.estado === "cerrado")) {
      delete patch.monto;
      delete patch.anticipo_aplicado;
    }
    if (patch.tipo === "anticipo") patch.anticipo_aplicado = 0;
    const { data, error } = await supabase.from("pagos").update(patch).eq("id", id).select("id");
    if (error) return { ok: false, error: friendlyError(error.message) };
    if (!data?.length) return { ok: false, error: "No se pudo guardar." };
    refresh(ocId);
    return { ok: true, id };
  }
  const { data, error } = await supabase.from("pagos").insert({ ...parsed.data, oc_id: ocId }).select("id").single();
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(ocId);
  return { ok: true, id: data.id };
}

export async function deletePagoAction(id: string, ocId: string): Promise<Result> {
  if (!(await rol("comprador"))) return { ok: false, error: "No autorizado" };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pago inválido" };
  const supabase = await createClient();
  const { error } = await supabase.from("pagos").delete().eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(ocId);
  return { ok: true };
}

/** Comprador: seguimiento de la importacion (carga liberada o no), urgente y comentario para el CEO. */
export async function seguimientoPagoAction(
  id: string,
  ocId: string,
  patch: { carga?: "sin_liberar" | "liberada"; urgente?: boolean; comentario?: string },
): Promise<Result> {
  if (!(await rol("comprador"))) return { ok: false, error: "Solo el comprador cambia el seguimiento." };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pago inválido" };
  const p: Record<string, unknown> = {};
  if (patch.carga === "sin_liberar" || patch.carga === "liberada") p.carga = patch.carga;
  if (typeof patch.urgente === "boolean") p.urgente = patch.urgente;
  if (typeof patch.comentario === "string") p.estado_nota = patch.comentario.trim().slice(0, 300) || null;
  if (!Object.keys(p).length) return { ok: true };
  const supabase = await createClient();
  const { data, error } = await supabase.from("pagos").update(p).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "No se pudo guardar." };
  refresh(ocId);
  return { ok: true };
}

/** Comprador: adjuntar el PDF de la factura. */
export async function facturaArchivoAction(fd: FormData): Promise<Result> {
  if (!(await rol("comprador"))) return { ok: false, error: "No autorizado" };
  const id = String(fd.get("id") ?? "");
  const ocId = String(fd.get("oc") ?? "");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pago inválido" };
  const f = archivo(fd);
  if (!f) return { ok: false, error: "Elige el archivo" };
  if (typeof f === "string") return { ok: false, error: f };
  const up = await subir(id, f, "factura");
  if ("error" in up) return { ok: false, error: up.error };
  const supabase = await createClient();
  const { error } = await supabase.from("pagos").update({ factura_path: up.path, factura_nombre: f.name.slice(0, 200) }).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(ocId);
  return { ok: true };
}

/** CEO: marcar pagado (fecha, monto, referencia) con comprobante opcional. */
export async function marcarPagadoAction(fd: FormData): Promise<Result> {
  if (!(await rol("ceo"))) return { ok: false, error: "Solo el CEO marca los pagos." };
  const id = String(fd.get("id") ?? "");
  const ocId = String(fd.get("oc") ?? "");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pago inválido" };
  const fecha = String(fd.get("fecha") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: "Escribe la fecha del pago" };
  const montoTxt = String(fd.get("monto") ?? "").replace(/,/g, "").trim();
  const monto = montoTxt ? Number(montoTxt) : null;
  if (monto !== null && !(monto > 0)) return { ok: false, error: "Monto inválido" };
  const f = archivo(fd);
  if (typeof f === "string") return { ok: false, error: f };
  let path: string | null = null;
  if (f) {
    const up = await subir(id, f, "comprobante");
    if ("error" in up) return { ok: false, error: up.error };
    path = up.path;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("pago_marcar_pagado", {
    p_id: id, p_fecha: fecha, p_monto: monto, p_referencia: String(fd.get("referencia") ?? "") || null,
    p_notas: String(fd.get("notas") ?? "") || null, p_path: path, p_nombre: f ? f.name : null,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(ocId);
  return { ok: true };
}

/** CEO: subir o cambiar el comprobante de un pago ya hecho. */
export async function comprobanteAction(fd: FormData): Promise<Result> {
  if (!(await rol("ceo"))) return { ok: false, error: "Solo el CEO sube comprobantes." };
  const id = String(fd.get("id") ?? "");
  const ocId = String(fd.get("oc") ?? "");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pago inválido" };
  const f = archivo(fd);
  if (!f) return { ok: false, error: "Elige el comprobante" };
  if (typeof f === "string") return { ok: false, error: f };
  const up = await subir(id, f, "comprobante");
  if ("error" in up) return { ok: false, error: up.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("pago_comprobante", { p_id: id, p_path: up.path, p_nombre: f.name });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(ocId);
  return { ok: true };
}

export async function deshacerPagoAction(id: string, ocId: string): Promise<Result> {
  if (!(await rol("ceo"))) return { ok: false, error: "No autorizado" };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pago inválido" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("pago_deshacer", { p_id: id });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(ocId);
  return { ok: true };
}

/** Comprador: pasar al historial sin descargar (por ejemplo, si el proveedor ya tiene el comprobante). */
export async function archivarPagoAction(id: string, ocId: string): Promise<Result> {
  if (!(await rol("comprador"))) return { ok: false, error: "No autorizado" };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pago inválido" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("pago_cerrar", { p_id: id });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(ocId);
  return { ok: true };
}

/** Comprador: renglones de texto de una proforma o factura en Excel (.xlsx) o Word (.docx), para leerla. */
export async function textoDocumentoAction(fd: FormData): Promise<Result<{ renglones: string[] }>> {
  if (!(await rol("comprador"))) return { ok: false, error: "No autorizado" };
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) return { ok: false, error: "Elige el archivo" };
  if (f.size > MAX) return { ok: false, error: "El archivo pesa más de 10 MB" };
  const n = f.name.toLowerCase();
  try {
    const { renglonesDocx, renglonesXlsx } = await import("@/lib/documento-texto");
    if (n.endsWith(".xlsx")) return { ok: true, renglones: await renglonesXlsx(await f.arrayBuffer()) };
    if (n.endsWith(".docx")) return { ok: true, renglones: await renglonesDocx(await f.arrayBuffer()) };
  } catch {
    return { ok: false, error: "No pude abrir el archivo. Revisa que no esté dañado o con contraseña." };
  }
  if (n.endsWith(".xls") || n.endsWith(".doc")) return { ok: false, error: "Es un formato viejo (.xls o .doc): ábrelo y guárdalo como .xlsx o .docx, o súbelo en PDF." };
  return { ok: false, error: "Sube el documento en PDF, Excel (.xlsx) o Word (.docx)." };
}
