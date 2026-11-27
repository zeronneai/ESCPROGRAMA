"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { EventoCal } from "@/lib/rrhh";
import type { Result } from "./requests";

const refrescar = () => {
  revalidatePath("/rrhh");
  revalidatePath("/rrhh/gerencia");
};
const msg = (m: string) => (/rrhh_/.test(m) && /exist|does not|no existe|could not find/i.test(m) ? "Falta correr la actualización 0092 o 0093 en Supabase." : friendlyError(m));
const esGerente = (rol: string) => rol === "gerente" || rol === "ceo";
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const uuid = z.string().uuid();

const solicitud = z
  .object({
    colaborador_id: uuid.nullable().optional(),
    tipo: z.enum(["vacaciones", "permiso"]),
    permiso_tipo: z.enum(["llegar_tarde", "salir_temprano", "ausentarse"]).nullable(),
    desde: fecha,
    hasta: fecha.nullable(),
    hora: z.string().trim().max(40).nullable(),
    motivo: z.string().trim().max(1000).nullable(),
  })
  .strict();

const TIPOS_EVIDENCIA: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

/** El colaborador pide vacaciones o un permiso (con evidencia opcional). */
export async function solicitarRhAction(fd: FormData): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  let datos: unknown;
  try {
    datos = JSON.parse(String(fd.get("datos") ?? ""));
  } catch {
    return { ok: false, error: "Datos inválidos" };
  }
  const p = solicitud.safeParse(datos);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
  const supabase = await createClient();
  let evidencia_path: string | null = null;
  let evidencia_nombre: string | null = null;
  const f = fd.get("evidencia");
  if (f instanceof File && f.size > 0) {
    if (f.size > 10 * 1024 * 1024) return { ok: false, error: "La evidencia pesa más de 10 MB" };
    const ext = TIPOS_EVIDENCIA[f.type];
    if (!ext) return { ok: false, error: "La evidencia debe ser PDF o foto (JPG, PNG)." };
    evidencia_path = `${u.id}/${randomUUID()}.${ext}`;
    evidencia_nombre = f.name.slice(0, 200);
    const { error } = await supabase.storage.from("rrhh").upload(evidencia_path, f, { contentType: f.type });
    if (error) return { ok: false, error: /bucket/i.test(error.message) ? "Falta correr la actualización 0092 en Supabase." : friendlyError(error.message) };
  }
  const { data, error } = await supabase.rpc("rrhh_solicitar", { p: { ...p.data, evidencia_path, evidencia_nombre } });
  if (error) return { ok: false, error: msg(error.message) };
  refrescar();
  return { ok: true, id: data as string };
}

/** Cuantos dias descontaria ese rango (sin domingos, festivos ni temporadas generales). */
export async function contarDiasRhAction(desde: string, hasta: string): Promise<number | null> {
  await requireUser();
  if (!fecha.safeParse(desde).success || !fecha.safeParse(hasta).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rrhh_contar_dias", { p_desde: desde, p_hasta: hasta });
  return error ? null : (data as number);
}

/** Visto bueno del jefe, autorizacion de la gerente (puede cambiar el tipo y los dias) o rechazo. */
/** Eventos del calendario de un mes (para cambiar de mes sin recargar la pagina). */
export async function calendarioRhAction(mes: string): Promise<EventoCal[] | null> {
  await requireUser();
  if (!/^\d{4}-\d{2}$/.test(mes)) return null;
  const [y, m] = mes.split("-").map(Number);
  const fin = `${mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rrhh_calendario", { p_desde: `${mes}-01`, p_hasta: fin });
  return error ? null : ((data ?? []) as EventoCal[]);
}

export async function resolverRhAction(
  id: string,
  accion: "visto" | "aprobar" | "rechazar",
  comentario?: string,
  cambio?: { tipo: "vacaciones" | "permiso"; permiso_tipo?: string | null; dias?: number | null },
): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success || !["visto", "aprobar", "rechazar"].includes(accion)) return { ok: false, error: "Solicitud inválida" };
  const dias = cambio?.dias;
  if (dias !== undefined && dias !== null && !(Number.isFinite(dias) && dias >= 0 && dias <= 60)) return { ok: false, error: "Días inválidos" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("rrhh_resolver", {
    p_id: id,
    p_accion: accion,
    p_comentario: comentario?.trim() || null,
    p_tipo: accion === "aprobar" ? (cambio?.tipo ?? null) : null,
    p_permiso_tipo: accion === "aprobar" ? (cambio?.permiso_tipo ?? null) : null,
    p_dias: accion === "aprobar" ? (dias ?? null) : null,
  });
  if (error) return { ok: false, error: msg(error.message) };
  refrescar();
  return { ok: true };
}

export async function cancelarRhAction(id: string): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Solicitud inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("rrhh_cancelar", { p_id: id });
  if (error) return { ok: false, error: msg(error.message) };
  refrescar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Gerente
// ---------------------------------------------------------------------------
async function gerente() {
  const u = await requireUser();
  if (!esGerente(u.rol)) throw new Error("Solo la gerente");
  return u;
}

const empleado = z
  .object({
    colaborador_id: uuid.nullable(),
    profile_id: uuid.nullable(),
    nombre: z.string().trim().max(120).nullable(),
    fecha_ingreso: fecha,
    puesto: z.string().trim().max(80).nullable(),
    departamento: z.string().trim().max(80).nullable(),
    saldo_inicial: z.number({ error: "Pon los días que le quedan." }).min(-60).max(400),
    saldo_al: fecha,
    notas: z.string().trim().max(500).nullable(),
  })
  .strict();

/** La gerente captura (o corrige) la fecha de ingreso y el arranque de dias de un colaborador. */
export async function guardarEmpleadoRhAction(input: z.input<typeof empleado>): Promise<Result> {
  try {
    await gerente();
  } catch {
    return { ok: false, error: "Solo la gerente captura los días." };
  }
  const p = empleado.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { colaborador_id, ...rest } = p.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("rrhh_empleado_guardar", { p: { ...rest, id: colaborador_id } });
  if (error) return { ok: false, error: msg(error.message) };
  refrescar();
  return { ok: true };
}

const externo = z
  .object({
    id: uuid.nullable(),
    nombre: z.string().trim().min(2, "Escribe el nombre.").max(120),
    puesto: z.string().trim().max(80).nullable(),
    activo: z.boolean().optional(),
    jefe_rol: z.enum(["jefe_ventas", "supervisor_almacen", "supervisor_finanzas"]).nullable().optional(),
  })
  .strict();

/** Colaborador sin portal: lo da de alta el supervisor de almacen (o la gerente). */
export async function guardarExternoRhAction(input: z.input<typeof externo>): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (!esGerente(u.rol) && u.rol !== "supervisor_almacen") return { ok: false, error: "Solo el supervisor de almacén o la gerente." };
  const p = externo.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rrhh_externo_guardar", { p: p.data });
  if (error) return { ok: false, error: /rrhh_externo_guardar/.test(error.message) ? "Falta correr la actualización 0093 en Supabase." : msg(error.message) };
  refrescar();
  return { ok: true, id: data as string };
}

const reglas = z
  .object({
    sabado_laborable: z.boolean(),
    anticipacion_dias: z.number().int().min(0).max(90),
    adelanto_max: z.number().int().min(0).max(60),
  })
  .strict();

export async function guardarReglasRhAction(input: z.input<typeof reglas>, tabla: { anios: number; dias: number }[]): Promise<Result> {
  let u;
  try {
    u = await gerente();
  } catch {
    return { ok: false, error: "Solo la gerente cambia las reglas." };
  }
  const p = reglas.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const t = z.array(z.object({ anios: z.number().int().min(1).max(60), dias: z.number().int().min(0).max(120) })).max(60).safeParse(tabla);
  if (!t.success) return { ok: false, error: "Revisa la tabla de días por año." };
  const supabase = await createClient();
  const { error } = await supabase.from("rrhh_config").update({ ...p.data, updated_by: u.id, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return { ok: false, error: msg(error.message) };
  if (t.data.length) {
    const { error: e2 } = await supabase.from("rrhh_tabla_dias").upsert(t.data);
    if (e2) return { ok: false, error: msg(e2.message) };
  }
  refrescar();
  return { ok: true };
}

export async function agregarFestivoRhAction(f: string, nombre: string): Promise<Result> {
  try {
    await gerente();
  } catch {
    return { ok: false, error: "Solo la gerente." };
  }
  if (!fecha.safeParse(f).success || nombre.trim().length < 2) return { ok: false, error: "Pon la fecha y el nombre del festivo." };
  const supabase = await createClient();
  const { error } = await supabase.from("rrhh_festivos").upsert({ fecha: f, nombre: nombre.trim().slice(0, 120) });
  if (error) return { ok: false, error: msg(error.message) };
  refrescar();
  return { ok: true };
}

export async function quitarFestivoRhAction(f: string): Promise<Result> {
  try {
    await gerente();
  } catch {
    return { ok: false, error: "Solo la gerente." };
  }
  if (!fecha.safeParse(f).success) return { ok: false, error: "Fecha inválida" };
  const supabase = await createClient();
  const { error } = await supabase.from("rrhh_festivos").delete().eq("fecha", f);
  if (error) return { ok: false, error: msg(error.message) };
  refrescar();
  return { ok: true };
}

const temporada = z
  .object({
    id: uuid.nullable(),
    nombre: z.string().trim().min(2, "Ponle nombre a la temporada.").max(80),
    desde: fecha,
    hasta: fecha,
    dias_descuento: z.array(fecha).max(60),
  })
  .strict();

/** Temporada de vacaciones generales (Semana Santa, Navidad) y los dias que se descuentan a todos. */
export async function guardarTemporadaRhAction(input: z.input<typeof temporada>): Promise<Result> {
  try {
    await gerente();
  } catch {
    return { ok: false, error: "Solo la gerente." };
  }
  const p = temporada.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (p.data.hasta < p.data.desde) return { ok: false, error: "La fecha final es antes de la inicial." };
  const supabase = await createClient();
  const row = { nombre: p.data.nombre, desde: p.data.desde, hasta: p.data.hasta, dias_descuento: p.data.dias_descuento };
  const { error } = p.data.id ? await supabase.from("rrhh_temporadas").update(row).eq("id", p.data.id) : await supabase.from("rrhh_temporadas").insert(row);
  if (error) return { ok: false, error: /hasta - desde/.test(error.message) ? "La temporada no puede pasar de 45 días." : msg(error.message) };
  refrescar();
  return { ok: true };
}

export async function borrarTemporadaRhAction(id: string): Promise<Result> {
  try {
    await gerente();
  } catch {
    return { ok: false, error: "Solo la gerente." };
  }
  if (!uuid.safeParse(id).success) return { ok: false, error: "Temporada inválida" };
  const supabase = await createClient();
  const { error } = await supabase.from("rrhh_temporadas").delete().eq("id", id);
  if (error) return { ok: false, error: msg(error.message) };
  refrescar();
  return { ok: true };
}
