/** Vacaciones y permisos (formato RR.HH.): tipos y textos comunes. */

export type TipoSolicitud = "vacaciones" | "permiso";
export type PermisoTipo = "llegar_tarde" | "salir_temprano" | "ausentarse";
export type EstadoSolicitud = "pendiente" | "visto_jefe" | "aprobada" | "rechazada" | "cancelada";

export const PERMISO_LABEL: Record<PermisoTipo, string> = {
  llegar_tarde: "Llegar tarde",
  salir_temprano: "Salir temprano",
  ausentarse: "Ausentarse",
};

export const ESTADO_LABEL: Record<EstadoSolicitud, string> = {
  pendiente: "En espera",
  visto_jefe: "Visto bueno del jefe",
  aprobada: "Autorizada",
  rechazada: "No autorizada",
  cancelada: "Cancelada",
};

export const ESTADO_COLOR: Record<EstadoSolicitud, string> = {
  pendiente: "bg-amber-100 text-amber-800",
  visto_jefe: "bg-sky-100 text-sky-800",
  aprobada: "bg-green-100 text-green-800",
  rechazada: "bg-red-100 text-red-700",
  cancelada: "bg-slate-100 text-slate-600",
};

export type JefeRol = "jefe_ventas" | "supervisor_almacen" | "supervisor_finanzas";

/** Quien da el primer visto bueno (despues siempre autoriza la gerente). */
export const JEFE_LABEL: Record<JefeRol, string> = {
  jefe_ventas: "Jefa de ventas",
  supervisor_almacen: "Supervisor de almacén",
  supervisor_finanzas: "Supervisora de finanzas",
};

export function quienAutoriza(j: JefeRol | null | undefined): string {
  return j ? `${JEFE_LABEL[j]} y luego la gerente` : "Directo con la gerente";
}

export interface Saldo {
  colaborador_id: string;
  empleado_id: string | null;
  nombre: string;
  rol: string | null;
  sin_portal: boolean;
  jefe_rol: JefeRol | null;
  capturado: boolean;
  fecha_ingreso: string | null;
  puesto: string | null;
  departamento: string | null;
  anios: number | null;
  dias_ley: number | null;
  proximo_aniversario: string | null;
  dias_proximo: number | null;
  saldo_inicial: number | null;
  saldo_al: string | null;
  ganados: number | null;
  usados: number | null;
  temporada: number | null;
  pendientes: number | null;
  disponible: number | null;
  permisos_anio: number;
}

export interface Solicitud {
  id: string;
  folio: number;
  colaborador_id: string;
  empleado_id: string | null;
  nombre: string;
  puesto: string | null;
  rol: string | null;
  sin_portal: boolean;
  jefe_rol: JefeRol | null;
  tipo: TipoSolicitud;
  permiso_tipo: PermisoTipo | null;
  desde: string;
  hasta: string;
  hora: string | null;
  motivo: string | null;
  dias: number;
  estado: EstadoSolicitud;
  evidencia_nombre: string | null;
  tiene_evidencia: boolean;
  jefe_nombre: string | null;
  jefe_at: string | null;
  resuelto_nombre: string | null;
  resuelto_at: string | null;
  registro_nombre: string | null;
  comentario: string | null;
  cambio: string | null;
  created_at: string;
  mia: boolean;
  soy_jefe: boolean;
}

export interface EventoCal {
  clase: "festivo" | "temporada" | "vacaciones" | "permiso";
  desde: string;
  hasta: string;
  titulo: string;
  puesto: string | null;
  nombre: string | null;
  mio: boolean;
  estado: EstadoSolicitud | null;
  descuento: string[] | null;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MESES_LARGOS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** "2026-12-22" -> "22 dic 2026" (sin zona horaria). */
export function fechaRh(iso: string | null | undefined, conAnio = true): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MESES[m - 1]}${conAnio ? ` ${y}` : ""}`;
}

export function rangoRh(desde: string, hasta: string): string {
  if (desde === hasta) return fechaRh(desde);
  const mismoAnio = desde.slice(0, 4) === hasta.slice(0, 4);
  return `${fechaRh(desde, !mismoAnio)} al ${fechaRh(hasta)}`;
}

export function num(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Dias que da la LFT (art. 76) al cumplir N anios: 12, 14, 16, 18, 20 y luego +2 cada 5 anios. */
export function diasLey(anios: number): number {
  if (anios < 1) return 0;
  if (anios <= 5) return 10 + 2 * anios;
  return 22 + 2 * Math.floor((anios - 6) / 5);
}

/** Cuadricula de un mes (lunes a domingo): fechas ISO o null para huecos. */
export function semanasDelMes(anio: number, mes0: number): (string | null)[][] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ultimo = new Date(Date.UTC(anio, mes0 + 1, 0)).getUTCDate();
  const primero = (new Date(Date.UTC(anio, mes0, 1)).getUTCDay() + 6) % 7;
  const celdas: (string | null)[] = Array(primero).fill(null);
  for (let d = 1; d <= ultimo; d++) celdas.push(`${anio}-${pad(mes0 + 1)}-${pad(d)}`);
  while (celdas.length % 7) celdas.push(null);
  const out: (string | null)[][] = [];
  for (let i = 0; i < celdas.length; i += 7) out.push(celdas.slice(i, i + 7));
  return out;
}

/** Dias (ISO) entre dos fechas, incluidas. */
export function diasEntre(desde: string, hasta: string): string[] {
  const out: string[] = [];
  const d = new Date(desde + "T12:00:00Z");
  const fin = new Date(hasta + "T12:00:00Z");
  while (d <= fin && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Dia de la semana ISO (1 lunes ... 7 domingo). */
export function isoDow(iso: string): number {
  const g = new Date(iso + "T12:00:00Z").getUTCDay();
  return g === 0 ? 7 : g;
}
