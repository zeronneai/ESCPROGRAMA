"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { GUIA_FILE_TYPES, guiaSchema, partirDireccion, resumenPartidas, type GuiaInput } from "@/lib/ops/guias";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();
const refresh = (id?: string) => {
  revalidatePath("/guias");
  if (id) revalidatePath(`/guias/${id}`);
};

const CAMPOS_GUIA: Record<string, string> = {
  factura: "la factura", destinatario: "el destinatario", paqueteria: "la paquetería", servicio: "el servicio", customer_id: "el cliente",
  contacto_nombre: "el nombre de quien recibe", telefono: "el teléfono de quien recibe", correo: "el correo", calle_numero: "la calle y número", cp: "el código postal", ciudad: "la ciudad",
  estado_geo: "el estado", partidas: "las partidas", valor_declarado: "el valor declarado", contenido: "el contenido",
};

export async function saveGuiaAction(id: string | null, input: GuiaInput): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (u.rol !== "vendedor" && u.rol !== "comprador") return { ok: false, error: "Las guías las piden los vendedores y compras." };
  const parsed = guiaSchema.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    // Por si sale un mensaje generico ("Invalid input"): decir en que campo.
    const generico = /invalid|expected|required/i.test(i.message);
    const campo = CAMPOS_GUIA[String(i.path[0])] ?? String(i.path[0] ?? "");
    const partida = i.path[0] === "partidas" && typeof i.path[1] === "number" ? ` (partida ${i.path[1] + 1})` : "";
    return { ok: false, error: generico ? `Revisa ${campo || "los datos"}${partida}.` : `${i.message}${partida}` };
  }
  const supabase = await createClient();
  if (parsed.data.sentido === "recoleccion" && u.rol !== "comprador") return { ok: false, error: "Las recolecciones con proveedor las pide compras." };
  let datos: Record<string, unknown> = parsed.data;
  // Envio normal: no se mandan los datos de origen (asi funciona aunque falte la 0057).
  if (parsed.data.sentido === "envio") {
    const { sentido: _s, recoleccion_modo: _m, recoleccion_fecha: _fe, origen_nombre: _a, origen_contacto: _b, origen_telefono: _c, origen_calle_numero: _d, origen_colonia: _e, origen_cp: _f, origen_ciudad: _g, origen_estado_geo: _h, ...resto } = parsed.data;
    datos = resto;
  } else {
    const { entrega_modo: _em, ...resto } = datos as typeof parsed.data;
    void _em;
    datos = resto;
  }
  // Sin la actualizacion 0049 todavia: se guardan los totales y las partidas van en el contenido.
  const sinPartidas = (msg: string) => /partidas|guias_empaque_check|valor_moneda/.test(msg);
  const sinRecoleccion = (msg: string) => /sentido|origen_|recoleccion/.test(msg);
  // Sin la 0062 todavia no existe entrega_modo: se guarda en las notas.
  const sinModo = (msg: string) => /entrega_modo/.test(msg);
  const conModoEnNotas = () => {
    const { entrega_modo, ...resto } = datos as typeof parsed.data;
    const t = entrega_modo === "ocurre" ? "OCURRE" : entrega_modo === "recoleccion" ? "RECOLECCIÓN" : "";
    return { ...resto, notas: [t, resto.notas].filter(Boolean).join(" · ").slice(0, 1000) || null };
  };
  const respaldo = () => {
    const { partidas, valor_moneda, ...resto } = datos as typeof parsed.data;
    const detalle = partidas.length > 1
      ? partidas.map((p) => `${p.cantidad} ${p.empaque === "tarima" ? "tarima(s)" : "bulto(s)"} ${p.peso_kg} kg c/u${p.largo_cm && p.ancho_cm && p.alto_cm ? ` ${p.largo_cm}x${p.ancho_cm}x${p.alto_cm} cm` : ""}${p.descripcion ? ` (${p.descripcion})` : ""}`).join("; ")
      : "";
    return {
      ...resto,
      empaque: resto.empaque === "mixto" ? "tarima" : resto.empaque,
      contenido: [detalle && `${resumenPartidas(partidas)}: ${detalle}`, resto.contenido, valor_moneda === "USD" && resto.valor_declarado != null ? `Valor declarado en USD` : ""].filter(Boolean).join(" · ").slice(0, 300) || null,
    };
  };
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
    let { data, error } = await supabase.from("guias").update(datos).eq("id", id).select("id");
    if (error && sinModo(error.message)) ({ data, error } = await supabase.from("guias").update((datos = conModoEnNotas())).eq("id", id).select("id"));
    if (error && sinPartidas(error.message)) ({ data, error } = await supabase.from("guias").update((datos = respaldo())).eq("id", id).select("id"));
    if (error) return { ok: false, error: sinRecoleccion(error.message) ? "Primero corre la actualización 0057 en Supabase." : friendlyError(error.message) };
    if (!data?.length) return { ok: false, error: "Ya no puedes editar esta guía." };
    if (parsed.data.sentido === "recoleccion") await guardarProveedorDeGuia(supabase, parsed.data).catch(() => null);
    refresh(id);
    return { ok: true, id };
  }
  let { data, error } = await supabase.from("guias").insert(datos).select("id").single();
  if (error && sinModo(error.message)) ({ data, error } = await supabase.from("guias").insert((datos = conModoEnNotas())).select("id").single());
  if (error && sinPartidas(error.message)) ({ data, error } = await supabase.from("guias").insert(respaldo()).select("id").single());
  if (error || !data) return { ok: false, error: error && sinRecoleccion(error.message) ? "Primero corre la actualización 0057 en Supabase." : friendlyError(error?.message ?? "No se pudo guardar") };
  // Recoleccion: el proveedor queda en el catalogo de proveedores (o se completan sus datos).
  if (parsed.data.sentido === "recoleccion") await guardarProveedorDeGuia(supabase, parsed.data).catch(() => null);
  refresh();
  return { ok: true, id: data.id };
}

/** Compras adjunta la orden de compra (PDF) a su guia de recoleccion. */
export async function subirOcGuiaAction(formData: FormData): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "comprador") return { ok: false, error: "La OC la adjunta compras." };
  const id = String(formData.get("id") ?? "");
  const file = formData.get("file");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Elige la orden de compra" };
  if (!GUIA_FILE_TYPES.includes(file.type)) return { ok: false, error: "La OC debe ser PDF, PNG o JPG" };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "La OC pesa más de 10 MB" };
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "oc.pdf";
  const path = `${id}/oc-${Date.now()}-${safe}`;
  const supabase = await createClient();
  const { error: up } = await supabase.storage.from("guias").upload(path, file, { contentType: file.type });
  if (up) return { ok: false, error: /row-level|policy/i.test(up.message) ? "Primero corre la actualización 0057 en Supabase." : friendlyError(up.message) };
  const { error } = await supabase.rpc("guia_oc", { p_id: id, p_path: path, p_nombre: file.name.slice(0, 200) });
  if (error) return { ok: false, error: /guia_oc|does not exist|schema cache/i.test(error.message) ? "Primero corre la actualización 0057 en Supabase." : friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

async function mover(id: string, estado: "en_proceso" | "requiere_datos", nota?: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "marketplaces") return { ok: false, error: "Solo Marketplaces atiende las guías." };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("guia_mover", { p_id: id, p_estado: estado, p_nota: nota?.trim() || null });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}
export async function tomarGuiaAction(id: string): Promise<Result> {
  return mover(id, "en_proceso");
}
export async function pedirDatosGuiaAction(id: string, mensaje: string): Promise<Result> {
  if (mensaje.trim().length < 3) return { ok: false, error: "Escribe qué dato falta." };
  return mover(id, "requiere_datos", mensaje);
}

/** Marketplaces sube la guia (PDF o imagen) y el numero de rastreo. */
export async function subirGuiaAction(formData: FormData): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "marketplaces") return { ok: false, error: "Solo Marketplaces sube las guías." };
  const id = String(formData.get("id") ?? "");
  const rastreo = String(formData.get("rastreo") ?? "").trim().slice(0, 80);
  if (rastreo.length < 3) return { ok: false, error: "Escribe el número de guía: es lo único que ve el vendedor." };
  const file = formData.get("file");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Elige el archivo de la guía" };
  if (!GUIA_FILE_TYPES.includes(file.type)) return { ok: false, error: "La guía debe ser PDF, PNG o JPG" };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "El archivo pesa más de 10 MB" };
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "guia.pdf";
  const path = `${id}/${Date.now()}-${safe}`;
  const supabase = await createClient();
  const { error: up } = await supabase.storage.from("guias").upload(path, file, { contentType: file.type });
  if (up) return { ok: false, error: friendlyError(up.message) };
  const bulto = String(formData.get("bulto") ?? "").trim().slice(0, 80);
  // Varios archivos por guia (uno por bulto o tarima). Sin la 0054 se usa el paso de siempre (un archivo).
  let { error } = await supabase.rpc("guia_archivo_agregar", { p_id: id, p_path: path, p_nombre: file.name.slice(0, 200), p_rastreo: rastreo, p_bulto: bulto || null });
  if (error && /guia_archivo_agregar|function .* does not exist|schema cache/i.test(error.message)) {
    ({ error } = await supabase.rpc("guia_mover", { p_id: id, p_estado: "lista", p_rastreo: rastreo || null, p_path: path, p_nombre: file.name.slice(0, 200) }));
  }
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

/** Marketplaces quita un archivo de guia que subio por error. */
export async function quitarArchivoGuiaAction(id: string, idx: number): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "marketplaces") return { ok: false, error: "Solo Marketplaces quita las guías." };
  if (!uuid.safeParse(id).success || !Number.isInteger(idx) || idx < 0) return { ok: false, error: "Archivo inválido" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("guia_archivo_quitar", { p_id: id, p_idx: idx });
  if (error) return { ok: false, error: /guia_archivo_quitar|does not exist|schema cache/i.test(error.message) ? "Primero corre la actualización 0054 en Supabase." : friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

export async function recordarGuiaAction(id: string): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("guia_recordar", { p_id: id });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

export async function cancelarGuiaAction(id: string, nota: string): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("guia_cancelar", { p_id: id, p_nota: nota.trim() || null });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

export async function commentGuiaAction(id: string, nota: string): Promise<Result> {
  await requireUser();
  const n = z.string().trim().min(2, "Escribe el mensaje").max(1000).safeParse(nota);
  if (!n.success) return { ok: false, error: n.error.issues[0].message };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Guía inválida" };
  const supabase = await createClient();
  const { error } = await supabase.from("guia_eventos").insert({ guia_id: id, tipo: "comentario", nota: n.data });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true };
}

export type DatosFacturaGuia = {
  folio: string;
  customer_id: string | null;
  destinatario: string;
  contacto_nombre: string;
  telefono: string;
  correo: string;
  calle_numero: string;
  colonia: string;
  cp: string;
  ciudad: string;
  estado_geo: string;
  contenido: string;
  valor_declarado: string;
  valor_moneda: "MXN" | "USD";
  /** "Cliente · Sucursal" si se mando al domicilio de entrega. */
  entrega: boolean;
};

type CustGuia = { id: string; nombre: string; sucursal: string | null; parent_id: string | null; direccion: string | null; estado_geo: string | null; contacto_nombre: string | null; contacto_telefono: string | null; contacto_correo: string | null };

/** La factura ya se subio como venta: se toman el cliente (o la sucursal de entrega), su domicilio y lo que lleva. */
export async function datosFacturaGuiaAction(folio: string): Promise<DatosFacturaGuia | null> {
  await requireUser();
  const f = folio.trim().toUpperCase();
  if (!f || f.length > 40) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("ventas")
    .select("factura, monto, moneda, customer_id, customers(id, nombre, sucursal, parent_id, direccion, estado_geo, contacto_nombre, contacto_telefono, contacto_correo), venta_lineas(descripcion, cantidad)")
    .ilike("factura", f)
    .is("cancelada_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const v = data as unknown as { factura: string; monto: number | null; moneda: string | null; customer_id: string | null; customers: CustGuia | null; venta_lineas: { descripcion: string; cantidad: number | null }[] };
  const c = v.customers;
  let matriz: CustGuia | null = null;
  if (c?.parent_id) {
    const { data: m } = await supabase.from("customers").select("id, nombre, sucursal, parent_id, direccion, estado_geo, contacto_nombre, contacto_telefono, contacto_correo").eq("id", c.parent_id).maybeSingle();
    matriz = (m as CustGuia | null) ?? null;
  }
  const dir = partirDireccion(c?.direccion ?? matriz?.direccion);
  const lineas = (v.venta_lineas ?? []).filter((l) => l.descripcion && !/^flete$/i.test(l.descripcion.trim()));
  const contenido = lineas.map((l) => `${l.cantidad != null ? `${Number(l.cantidad)} ` : ""}${l.descripcion}`).join("; ");
  return {
    folio: v.factura,
    customer_id: c?.id ?? null,
    destinatario: c?.nombre ?? "",
    contacto_nombre: c?.contacto_nombre ?? matriz?.contacto_nombre ?? "",
    telefono: c?.contacto_telefono ?? matriz?.contacto_telefono ?? "",
    correo: c?.contacto_correo ?? matriz?.contacto_correo ?? "",
    ...dir,
    estado_geo: dir.estado_geo || c?.estado_geo || matriz?.estado_geo || "",
    contenido: contenido.length > 300 ? `${contenido.slice(0, 297)}...` : contenido,
    valor_declarado: v.monto != null ? String(v.monto) : "",
    valor_moneda: v.moneda === "USD" ? "USD" : "MXN",
    entrega: !!c?.parent_id,
  };
}

/** Marketplaces palomea (o despalomea) una partida de la guia conforme la va armando. */
export async function palomearPartidaAction(id: string, idx: number, lista: boolean): Promise<{ ok: true; listas: number[] } | { ok: false; error: string }> {
  const u = await requireUser();
  if (u.rol !== "marketplaces") return { ok: false, error: "Solo Marketplaces palomea las partidas." };
  if (!uuid.safeParse(id).success || !Number.isInteger(idx) || idx < 0 || idx >= 30) return { ok: false, error: "Partida inválida" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guia_palomear", { p_id: id, p_idx: idx, p_lista: lista });
  if (error) return { ok: false, error: /guia_palomear/.test(error.message) ? "Primero corre la actualización 0052 en Supabase." : friendlyError(error.message) };
  return { ok: true, listas: (data as number[]) ?? [] };
}

/** Datos del proveedor del catalogo (contacto y telefono) para la guia de recoleccion. */
export async function proveedorGuiaAction(nombre: string): Promise<{ nombre: string; contacto: string | null; telefono: string | null; direccion: string | null } | null> {
  const u = await requireUser();
  if (u.rol !== "comprador") return null;
  const supabase = await createClient();
  const data = await buscarProveedor(supabase, nombre);
  if (!data) return null;
  return { nombre: data.nombre, contacto: data.contacto_nombre ?? null, telefono: data.telefono ?? null, direccion: data.direccion ?? null };
}

/** "CARNIPROTEK S.A DE C.V" -> "CARNIPROTEK" (para encontrarlo aunque el nombre no sea identico). */
function claveProveedor(nombre: string) {
  return nombre.toUpperCase().replace(/\b(S\.?\s?A\.?|DE|C\.?\s?V\.?|S\.?\s?DE\s?R\.?\s?L\.?|SAPI)\b\.?/g, " ").replace(/[^\wÁÉÍÓÚÑ ]/g, " ").trim().split(/\s+/).filter((w) => w.length >= 3).slice(0, 2).join(" ").replace(/[%,()]/g, "");
}
type ProvCat = { id: string; nombre: string; razon_social: string | null; contacto_nombre: string | null; telefono: string | null; direccion: string | null };
async function buscarProveedor(supabase: Awaited<ReturnType<typeof createClient>>, nombre: string): Promise<ProvCat | null> {
  const clave = claveProveedor(nombre);
  if (clave.length < 3) return null;
  const { data } = await supabase.from("suppliers").select("id, nombre, razon_social, contacto_nombre, telefono, direccion")
    .or(`nombre.ilike.%${clave}%,razon_social.ilike.%${clave}%`).limit(1).maybeSingle();
  return (data as ProvCat | null) ?? null;
}

/**
 * La guia de recoleccion alimenta el catalogo de proveedores: si el proveedor no existe se da de alta
 * con sus datos; si ya existe, solo se llenan los datos que le faltaban (nunca se sobreescribe nada).
 */
async function guardarProveedorDeGuia(supabase: Awaited<ReturnType<typeof createClient>>, g: {
  origen_nombre: string | null; origen_contacto: string | null; origen_telefono: string | null; origen_calle_numero: string | null;
  origen_colonia: string | null; origen_cp: string | null; origen_ciudad: string | null; origen_estado_geo: string | null;
}): Promise<"alta" | "actualizado" | null> {
  if (!g.origen_nombre) return null;
  const direccion = [g.origen_calle_numero, g.origen_colonia && `Col. ${g.origen_colonia}`, g.origen_cp && `C.P. ${g.origen_cp}`, [g.origen_ciudad, g.origen_estado_geo].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null;
  const existe = await buscarProveedor(supabase, g.origen_nombre);
  if (!existe) {
    const { error } = await supabase.from("suppliers").insert({
      nombre: g.origen_nombre.slice(0, 200), razon_social: g.origen_nombre.slice(0, 200), contacto_nombre: g.origen_contacto, telefono: g.origen_telefono,
      direccion, tipo: "nacional", pais: "México",
    });
    if (!error) revalidatePath("/comprador/proveedores");
    return error ? null : "alta";
  }
  const faltan: Record<string, string> = {};
  if (!existe.razon_social) faltan.razon_social = g.origen_nombre.slice(0, 200);
  if (!existe.contacto_nombre && g.origen_contacto) faltan.contacto_nombre = g.origen_contacto;
  if (!existe.telefono && g.origen_telefono) faltan.telefono = g.origen_telefono;
  if (!existe.direccion && direccion) faltan.direccion = direccion;
  if (!Object.keys(faltan).length) return null;
  const { error } = await supabase.from("suppliers").update(faltan).eq("id", existe.id);
  if (!error) revalidatePath("/comprador/proveedores");
  return error ? null : "actualizado";
}
