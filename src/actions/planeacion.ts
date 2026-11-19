"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { addDias, folioOc, type EstadoOc } from "@/lib/planeacion";
import { claveDeArticulo } from "@/lib/pegatron-recuento";
import { hoyMx } from "@/lib/planeacion-server";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const refrescar = (ocId?: string) => {
  revalidatePath("/comprador/planeacion");
  if (ocId) revalidatePath(`/comprador/planeacion/oc/${ocId}`);
};
async function comprador() {
  const u = await requireUser();
  return u.rol === "comprador" ? u : null;
}
const NO = { ok: false as const, error: "Solo el comprador maneja la planeación de compras." };

/** Al generar la OC, lo de Pegatron (de linea) de esos articulos queda marcado como pedido. */
async function marcarPegatronPedido(supabase: Awaited<ReturnType<typeof createClient>>, claves: string[]) {
  try {
    const traer = (cols: string) => supabase.from("pegatron_oc").select(`${cols}, pegatron_oc_lineas(id, articulo_esc, pedido_at)`).limit(1000);
    let { data, error } = await traer("id, tipo");
    if (error && /tipo/.test(error.message)) ({ data, error } = await traer("id"));
    if (error) return;
    const set = new Set(claves.map((c) => c.toUpperCase()));
    for (const o of (data ?? []) as unknown as { tipo?: string | null; pegatron_oc_lineas: { id: string; articulo_esc: string; pedido_at: string | null }[] }[]) {
      if (o.tipo === "sobrepedido") continue;
      for (const l of o.pegatron_oc_lineas ?? []) {
        const c = claveDeArticulo(l.articulo_esc);
        if (!l.pedido_at && c && set.has(c)) await supabase.rpc("pegatron_pedido", { p_linea: l.id, p_pedido: true });
      }
    }
    revalidatePath("/pedidos-pegatron", "layout");
  } catch {
    // Si falla no se detiene la OC: el comprador puede marcarlo en Pedidos Pegatron.
  }
}

const lineaNueva = z.object({ clave: z.string().trim().min(1).max(60), cantidad: z.number().positive().max(1e9), precio: z.number().min(0).nullable().optional() });

/** Genera la OC (borrador) con el folio de siempre: 26 + siglas + mes + dia. */
export async function crearOcAction(proveedorId: string, lineas: z.input<typeof lineaNueva>[], notas?: string): Promise<Result<{ id: string; folio: string }>> {
  if (!(await comprador())) return NO;
  if (!uuid.safeParse(proveedorId).success) return { ok: false, error: "Proveedor inválido" };
  const ls = z.array(lineaNueva).min(1, "Pon al menos un artículo con cantidad.").max(300).safeParse(lineas.filter((l) => l.cantidad > 0));
  if (!ls.success) return { ok: false, error: ls.error.issues[0].message };
  const supabase = await createClient();
  const { data: prov, error: pe } = await supabase.from("plan_proveedores").select("id, codigo, entrega_dias, nombre").eq("id", proveedorId).single();
  if (pe || !prov) return { ok: false, error: "No encontré el proveedor." };
  if (!prov.codigo) return { ok: false, error: `Ponle siglas a ${prov.nombre} (Ajustes del proveedor) para armar el folio.` };
  const hoy = hoyMx();
  const base = `${hoy.slice(2, 4)}${prov.codigo}${hoy.slice(5, 7)}${hoy.slice(8, 10)}`;
  const { data: usados } = await supabase.from("plan_ocs").select("folio").like("folio", `${base}%`);
  const folio = folioOc(prov.codigo, hoy, (usados ?? []).map((u) => u.folio));
  const { data: oc, error } = await supabase
    .from("plan_ocs")
    .insert({ folio, proveedor_id: proveedorId, fecha: hoy, estado: "borrador", llegada_estimada: addDias(hoy, prov.entrega_dias), notas: notas?.trim() || null })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendlyError(error.message) };
  const filas = new Map<string, { clave: string; cantidad: number; precio: number | null }>();
  for (const l of ls.data) {
    const f = filas.get(l.clave);
    if (f) f.cantidad += l.cantidad;
    else filas.set(l.clave, { clave: l.clave, cantidad: l.cantidad, precio: l.precio ?? null });
  }
  const { error: le } = await supabase.from("plan_oc_lineas").insert([...filas.values()].map((f) => ({ ...f, oc_id: oc.id })));
  if (le) {
    await supabase.from("plan_ocs").delete().eq("id", oc.id);
    return { ok: false, error: friendlyError(le.message) };
  }
  await marcarPegatronPedido(supabase, [...filas.keys()]);
  refrescar(oc.id);
  return { ok: true, id: oc.id, folio };
}

const edicion = z.object({
  llegada_estimada: fecha.nullable().optional(),
  notas: z.string().max(2000).nullable().optional(),
  lineas: z
    .array(z.object({ id: z.string().uuid(), cantidad: z.number().min(0).max(1e9).optional(), cantidad_proforma: z.number().min(0).max(1e9).nullable().optional(), precio: z.number().min(0).nullable().optional() }))
    .max(300)
    .optional(),
  nuevas: z.array(lineaNueva).max(100).optional(),
});

/** Guardar cambios: en borrador se cambian cantidades (0 = quitar); despues, lo que confirma la proforma. */
export async function guardarOcAction(id: string, input: z.input<typeof edicion>): Promise<Result> {
  if (!(await comprador())) return NO;
  if (!uuid.safeParse(id).success) return { ok: false, error: "OC inválida" };
  const p = edicion.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const { data: oc } = await supabase.from("plan_ocs").select("estado").eq("id", id).single();
  if (!oc) return { ok: false, error: "No encontré la OC." };
  if (oc.estado === "recibida" || oc.estado === "cancelada") return { ok: false, error: "Esta OC ya está cerrada." };
  const cab: Record<string, unknown> = {};
  if (p.data.llegada_estimada !== undefined) cab.llegada_estimada = p.data.llegada_estimada;
  if (p.data.notas !== undefined) cab.notas = p.data.notas?.trim() || null;
  if (Object.keys(cab).length) {
    const { error } = await supabase.from("plan_ocs").update(cab).eq("id", id);
    if (error) return { ok: false, error: friendlyError(error.message) };
  }
  for (const l of p.data.lineas ?? []) {
    if (oc.estado === "borrador" && l.cantidad === 0) {
      await supabase.from("plan_oc_lineas").delete().eq("id", l.id).eq("oc_id", id);
      continue;
    }
    const upd: Record<string, unknown> = {};
    if (oc.estado === "borrador" && l.cantidad) upd.cantidad = l.cantidad;
    if (oc.estado !== "borrador" && l.cantidad_proforma !== undefined) upd.cantidad_proforma = l.cantidad_proforma;
    if (l.precio !== undefined) upd.precio = l.precio;
    if (!Object.keys(upd).length) continue;
    const { error } = await supabase.from("plan_oc_lineas").update(upd).eq("id", l.id).eq("oc_id", id);
    if (error) return { ok: false, error: friendlyError(error.message) };
  }
  if (p.data.nuevas?.length) {
    if (oc.estado !== "borrador") return { ok: false, error: "Solo se agregan artículos mientras la OC está en borrador." };
    const { error } = await supabase.from("plan_oc_lineas").upsert(
      p.data.nuevas.map((n) => ({ oc_id: id, clave: n.clave, cantidad: n.cantidad, precio: n.precio ?? null })),
      { onConflict: "oc_id,clave" },
    );
    if (error) return { ok: false, error: friendlyError(error.message) };
  }
  refrescar(id);
  return { ok: true };
}

const SIGUE: Record<EstadoOc, EstadoOc[]> = {
  borrador: ["enviada", "cancelada"],
  enviada: ["proforma", "embarcada", "recibida", "cancelada", "borrador"],
  proforma: ["embarcada", "recibida", "cancelada", "enviada"],
  embarcada: ["recibida", "proforma"],
  recibida: ["embarcada"],
  cancelada: ["borrador"],
};

/** Cambiar el estado. Recibir una OC que llega completa pone como recibido lo de la proforma (o lo pedido). */
export async function estadoOcAction(id: string, estado: EstadoOc, opciones: { llegada_estimada?: string | null; fecha?: string | null } = {}): Promise<Result> {
  if (!(await comprador())) return NO;
  if (!uuid.safeParse(id).success) return { ok: false, error: "OC inválida" };
  const supabase = await createClient();
  const { data: oc } = await supabase.from("plan_ocs").select("estado, proveedor_id, plan_proveedores(recibe_parcial)").eq("id", id).single();
  if (!oc) return { ok: false, error: "No encontré la OC." };
  const actual = oc.estado as EstadoOc;
  if (!SIGUE[actual]?.includes(estado)) return { ok: false, error: `No se puede pasar de "${actual}" a "${estado}".` };
  const hoy = opciones.fecha && fecha.safeParse(opciones.fecha).success ? opciones.fecha : hoyMx();
  const cab: Record<string, unknown> = { estado };
  if (opciones.llegada_estimada !== undefined) cab.llegada_estimada = opciones.llegada_estimada;
  if (estado === "recibida") {
    cab.recibida_fecha = hoy;
    const { data: ls } = await supabase.from("plan_oc_lineas").select("id, cantidad, cantidad_proforma, recibido").eq("oc_id", id);
    for (const l of ls ?? []) {
      const total = l.cantidad_proforma != null ? Number(l.cantidad_proforma) : Number(l.cantidad);
      if (Number(l.recibido) >= total) continue;
      await supabase.from("plan_oc_lineas").update({ recibido: total, recibido_fecha: hoy }).eq("id", l.id);
    }
  }
  if (actual === "recibida") {
    // Se regresa a embarcada: se quita lo recibido para que vuelva a contar como en camino.
    await supabase.from("plan_oc_lineas").update({ recibido: 0, recibido_fecha: null }).eq("oc_id", id);
  }
  const { error } = await supabase.from("plan_ocs").update(cab).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refrescar(id);
  return { ok: true };
}

/** Recepcion por renglon (topglove): se escribe el total recibido de cada articulo. Si ya llego todo, se cierra. */
export async function recibirParcialAction(id: string, lineas: { id: string; recibido: number }[], fechaRecibo?: string | null): Promise<Result<{ cerrada: boolean }>> {
  if (!(await comprador())) return NO;
  if (!uuid.safeParse(id).success) return { ok: false, error: "OC inválida" };
  const ls = z.array(z.object({ id: z.string().uuid(), recibido: z.number().min(0).max(1e9) })).max(300).safeParse(lineas);
  if (!ls.success) return { ok: false, error: ls.error.issues[0].message };
  const hoy = fechaRecibo && fecha.safeParse(fechaRecibo).success ? fechaRecibo : hoyMx();
  const supabase = await createClient();
  const { data: oc } = await supabase.from("plan_ocs").select("estado").eq("id", id).single();
  if (!oc || oc.estado === "cancelada" || oc.estado === "recibida" || oc.estado === "borrador") return { ok: false, error: "Esta OC no está abierta para recibir." };
  const { data: prev } = await supabase.from("plan_oc_lineas").select("id, cantidad, cantidad_proforma, recibido").eq("oc_id", id);
  const mapa = new Map((prev ?? []).map((l) => [l.id, l]));
  for (const l of ls.data) {
    const p = mapa.get(l.id);
    if (!p || Number(p.recibido) === l.recibido) continue;
    const { error } = await supabase.from("plan_oc_lineas").update({ recibido: l.recibido, recibido_fecha: l.recibido > 0 ? hoy : null }).eq("id", l.id);
    if (error) return { ok: false, error: friendlyError(error.message) };
    p.recibido = l.recibido as unknown as string;
  }
  const completa = [...mapa.values()].every((l) => Number(l.recibido) >= Number(l.cantidad_proforma ?? l.cantidad));
  if (completa) await supabase.from("plan_ocs").update({ estado: "recibida", recibida_fecha: hoy }).eq("id", id);
  refrescar(id);
  return { ok: true, cerrada: completa };
}

/** Subir la proforma del proveedor. Si la OC estaba enviada pasa a "Con proforma". */
export async function subirProformaAction(fd: FormData): Promise<Result> {
  if (!(await comprador())) return NO;
  const id = String(fd.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { ok: false, error: "OC inválida" };
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Elige el archivo de la proforma." };
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: "El archivo pesa más de 15 MB." };
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const tipos: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel" };
  const tipo = tipos[ext];
  if (!tipo) return { ok: false, error: "Sube la proforma en PDF, Excel o imagen." };
  const supabase = await createClient();
  const { data: oc } = await supabase.from("plan_ocs").select("estado").eq("id", id).single();
  if (!oc) return { ok: false, error: "No encontré la OC." };
  const path = `${id}/proforma-${randomUUID().slice(0, 8)}-${file.name.replace(/[^\w.\-]+/g, "_").slice(-60)}`;
  const { error: up } = await supabase.storage.from("compras").upload(path, file, { contentType: tipo, upsert: false });
  if (up) return { ok: false, error: friendlyError(up.message) };
  const cab: Record<string, unknown> = { proforma_path: path, proforma_nombre: file.name.slice(0, 120) };
  if (oc.estado === "enviada" || oc.estado === "borrador") cab.estado = "proforma";
  const { error } = await supabase.from("plan_ocs").update(cab).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refrescar(id);
  return { ok: true };
}

const ajustes = z.object({
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, "Las siglas son de 2 a 4 letras").nullable(),
  entrega_dias: z.number().int().min(1).max(400),
  recibe_parcial: z.boolean(),
  tope_usd: z.number().positive().nullable(),
  contenedor_cbm: z.number().positive().nullable(),
  base_meses: z.number().min(0).max(24),
  objetivo_meses: z.number().min(0).max(36),
  punto_meses: z.number().min(0).max(36),
  cobertura_meses: z.number().min(0).max(36),
  razon_social: z.string().trim().max(200).nullable().optional(),
  contacto: z.string().trim().max(120).nullable().optional(),
  enviar_a: z.string().trim().max(300).nullable().optional(),
});

/** Ajustes del proveedor: siglas, dias de entrega y reglas para pedir. */
export async function ajustesProveedorAction(id: string, input: z.input<typeof ajustes>): Promise<Result> {
  if (!(await comprador())) return NO;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Proveedor inválido" };
  const p = ajustes.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const datos = { ...p.data, razon_social: p.data.razon_social || null, contacto: p.data.contacto || null, enviar_a: p.data.enviar_a || null };
  let { error } = await supabase.from("plan_proveedores").update(datos).eq("id", id);
  // Sin la actualizacion 0060 todavia no existen razon social, contacto y envio.
  if (error && /razon_social|contacto|enviar_a/.test(error.message)) {
    const { razon_social: _r, contacto: _c, enviar_a: _e, ...resto } = datos;
    void _r; void _c; void _e;
    ({ error } = await supabase.from("plan_proveedores").update(resto).eq("id", id));
  }
  if (error) return { ok: false, error: friendlyError(error.message) };
  refrescar();
  return { ok: true };
}
