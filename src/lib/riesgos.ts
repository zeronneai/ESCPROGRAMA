/**
 * Analisis y evaluacion de riesgo (formato de calidad de ESC, tipo AMEF).
 * Criterios, instrucciones y rangos tomados del formato en Excel "Formato de analisis de riesgo e instrucciones".
 */
import { z } from "zod";
import type { Rol } from "@/lib/auth/route-guard";

/** Puestos que hacen analisis de riesgo de su proceso (jefes de area) y el Coordinador ISO. */
export const RIESGO_ROLES: Rol[] = ["jefe_ventas", "supervisor_finanzas", "gerente", "ceo", "comprador", "almacen", "supervisor_almacen", "coordinador_iso"];

export type Calif = 1 | 2 | 3 | 4 | 5;
export type Criterio = { valor: Calif; texto: string[] };

export const CRITERIOS: Record<"severidad" | "ocurrencia" | "deteccion", { titulo: string; pregunta: string; niveles: Criterio[] }> = {
  severidad: {
    titulo: "Severidad",
    pregunta: "¿Qué tan grave sería el efecto si la falla pasa?",
    niveles: [
      { valor: 1, texto: ["No tiene impacto en el Sistema de Gestión Integral."] },
      { valor: 2, texto: ["Puede generar molestias del cliente o partes interesadas;", "producto no conforme controlado en el proceso, o", "incumplimientos aislados en las salidas del proceso."] },
      { valor: 3, texto: ["Puede generar quejas del cliente o partes interesadas;", "producto no conforme que se detecta y controla en un proceso posterior;", "posible incumplimiento a requisitos legales y regulatorios;", "incumplimientos constantes en las salidas del proceso, o", "posible afectación al cumplimiento de objetivos de calidad."] },
      { valor: 4, texto: ["Puede generar devoluciones del cliente e insatisfacción;", "producto no conforme controlado que se detecta en planta, antes de salir al cliente;", "incumplimiento a requisitos legales y regulatorios con sanción; incumplimiento en las salidas del proceso, o", "genera tendencias negativas al cumplimiento de objetivos de calidad."] },
      { valor: 5, texto: ["Puede generar cancelaciones del contrato con clientes;", "producto no conforme que sale de las instalaciones;", "incumplimiento a requisitos legales y regulatorios con cierre total o parcial, o", "incumplimiento a los objetivos de calidad."] },
    ],
  },
  ocurrencia: {
    titulo: "Ocurrencia",
    pregunta: "¿Con qué frecuencia puede presentarse?",
    niveles: [
      { valor: 1, texto: ["Es remoto que ocurra, al menos en el año una ocasión."] },
      { valor: 2, texto: ["Es probable que ocurra en el año, al menos cada semestre."] },
      { valor: 3, texto: ["Ocasionalmente ocurre, al menos cada bimestre."] },
      { valor: 4, texto: ["Ocurre cada mes."] },
      { valor: 5, texto: ["Es muy recurrente: diario, semanal o quincenal."] },
    ],
  },
  deteccion: {
    titulo: "Detección",
    pregunta: "¿Qué tan capaces somos de detectar la falla?",
    niveles: [
      { valor: 1, texto: ["Se cuenta con controles de detección y prevención en forma automatizada."] },
      { valor: 2, texto: ["Se cuenta con controles de prevención solamente."] },
      { valor: 3, texto: ["La aplicación de los controles depende de la mano de obra."] },
      { valor: 4, texto: ["Sólo se cuenta con controles de detección."] },
      { valor: 5, texto: ["No se cuenta con controles de detección o prevención."] },
    ],
  },
};

/** Nivel de riesgo (ROE) = Severidad x Ocurrencia x Detección. */
export function roe(s?: number | null, o?: number | null, d?: number | null): number | null {
  return s && o && d ? s * o * d : null;
}

export type NivelRoe = "bajo" | "medio" | "alto";
/** Rangos del formato: menos de 25 bajo (verde), de 25 a 74 medio (amarillo), 75 o más alto (rojo). */
export function nivelRoe(n: number | null): NivelRoe | null {
  if (n == null) return null;
  return n >= 75 ? "alto" : n >= 25 ? "medio" : "bajo";
}
export const NIVEL_ROE: Record<NivelRoe, { label: string; cls: string; rango: string; que: string }> = {
  bajo: { label: "Bajo", cls: "bg-green-500 text-white", rango: "1 a 24", que: "Riesgo aceptable: se monitorea." },
  medio: { label: "Medio", cls: "bg-yellow-300 text-slate-900", rango: "25 a 74", que: "Se recomienda definir acciones para reducirlo." },
  alto: { label: "Alto", cls: "bg-red-600 text-white", rango: "75 a 125", que: "Requiere acciones inmediatas, responsable y fecha." },
};

/** Instrucciones de llenado (hoja "Inst de llenado" del formato). */
export const INSTRUCCIONES: { n: number; campo: string; texto: string }[] = [
  { n: 1, campo: "Nombre del proceso", texto: "Nombre del proceso que desarrolla el análisis." },
  { n: 3, campo: "Artículo / Actividad", texto: "Desglose de actividades para analizar el riesgo." },
  { n: 4, campo: "Modo potencial de falla", texto: "Se determina el modo potencial de la falla probable." },
  { n: 5, campo: "Efectos potenciales de la falla", texto: "Es la afectación potencial en caso de que pase ese riesgo." },
  { n: 6, campo: "Vinculado con", texto: "Con qué se relaciona: cliente, requisito legal, objetivo de calidad, proveedor, cláusula de la norma, etc." },
  { n: 7, campo: "Riesgo / Oportunidad", texto: "Clasificación: si es un riesgo o una oportunidad." },
  { n: 9, campo: "Severidad", texto: "Qué tan grave puede ser el grado de afectación que tiene el efecto." },
  { n: 10, campo: "Causas potenciales / mecanismos de falla", texto: "Qué se deja o puede suceder para que se presente el riesgo." },
  { n: 11, campo: "Ocurrencia", texto: "La frecuencia con que pueda presentarse el riesgo." },
  { n: 12, campo: "Controles actuales de prevención", texto: "Qué controles se tienen para que el riesgo no se presente." },
  { n: 13, campo: "Controles actuales de detección", texto: "Los controles que nos ayudan a detectar la ocurrencia de los riesgos." },
  { n: 14, campo: "Detección", texto: "Capacidad para detectar las fallas probables." },
  { n: 16, campo: "Nivel de riesgo (ROE)", texto: "Es la multiplicación de Severidad x Ocurrencia x Detección. Sirve para conocer el nivel de riesgo." },
  { n: 18, campo: "Acciones recomendadas a realizar", texto: "Acciones que nos van a ayudar a minimizar o eliminar el riesgo." },
  { n: 19, campo: "Responsable", texto: "Responsable del seguimiento a las acciones que se determinen." },
  { n: 20, campo: "Fecha de terminación", texto: "Fecha compromiso de la toma de acciones." },
  { n: 21, campo: "Fecha y monitoreo de la efectividad", texto: "Fecha de la verificación de la efectividad de las acciones tomadas." },
  { n: 22, campo: "Acciones tomadas", texto: "Verificación de las acciones establecidas." },
  { n: 23, campo: "Severidad (residual)", texto: "Qué tan grave puede ser el efecto de acuerdo a las acciones tomadas." },
  { n: 24, campo: "Ocurrencia (residual)", texto: "La frecuencia con que pueda presentarse el riesgo de acuerdo a las acciones implementadas." },
  { n: 25, campo: "Detección (residual)", texto: "Capacidad para detectar las fallas probables una vez que se establecieron controles." },
  { n: 26, campo: "Nivel de riesgo residual", texto: "Severidad x Ocurrencia x Detección después de las acciones: muestra la efectividad de lo que se hizo." },
  { n: 27, campo: "Fecha del análisis", texto: "Fecha de realización del análisis." },
];

/** Sugerencias para "Vinculado con". */
export const VINCULOS = ["Cliente", "Requisito del cliente", "Requisito legal", "Objetivo de calidad", "Proveedor", "Producto", "Proceso", "Parte interesada", "Personal", "Infraestructura", "Cláusula ISO 9001"];

// ---------------------------------------------------------------------------
// Estructura guardada: actividades, cada una con varios modos de falla.
// ---------------------------------------------------------------------------
const t = (max: number) => z.string().max(max).optional().default("");
const calif = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).nullable().optional().default(null);
const fecha = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default("");

export const modoSchema = z.object({
  id: z.string().min(1).max(40),
  modo: t(500),
  efectos: t(1000),
  vinculado: t(200),
  tipo: z.enum(["riesgo", "oportunidad"]).default("riesgo"),
  severidad: calif,
  causas: t(1000),
  ocurrencia: calif,
  prevencion: t(1000),
  deteccion_ctrl: t(1000),
  deteccion: calif,
  acciones: t(1500),
  responsable: t(150),
  fecha_terminacion: fecha,
  fecha_verificacion: fecha,
  acciones_tomadas: t(1500),
  severidad_r: calif,
  ocurrencia_r: calif,
  deteccion_r: calif,
});
export const actividadSchema = z.object({
  id: z.string().min(1).max(40),
  actividad: z.string().max(300).default(""),
  modos: z.array(modoSchema).max(40),
});
export const analisisSchema = z.object({
  proceso: z.string().trim().min(2, "Escribe el nombre del proceso").max(200),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  actividades: z.array(actividadSchema).max(80),
});
export type Modo = z.infer<typeof modoSchema>;
export type Actividad = z.infer<typeof actividadSchema>;

export const nuevoId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const modoVacio = (): Modo => ({
  id: nuevoId(), modo: "", efectos: "", vinculado: "", tipo: "riesgo", severidad: null, causas: "", ocurrencia: null, prevencion: "", deteccion_ctrl: "",
  deteccion: null, acciones: "", responsable: "", fecha_terminacion: "", fecha_verificacion: "", acciones_tomadas: "", severidad_r: null, ocurrencia_r: null, deteccion_r: null,
});
export const actividadVacia = (): Actividad => ({ id: nuevoId(), actividad: "", modos: [modoVacio()] });

/** Etapa en la que va cada modo de falla. */
export function etapaModo(m: Modo): 1 | 2 | 3 | 4 | 5 {
  if (!m.modo.trim() || !m.efectos.trim()) return 1;
  if (!m.severidad || !m.ocurrencia || !m.deteccion) return 2;
  if (!m.acciones.trim()) return 3;
  if (!m.severidad_r || !m.ocurrencia_r || !m.deteccion_r) return 4;
  return 5;
}

/** Resumen de un analisis: cuantos modos hay en cada nivel y cuantos pendientes. */
export function resumenAnalisis(acts: Actividad[]) {
  const r = { modos: 0, alto: 0, medio: 0, bajo: 0, sinCalificar: 0, sinAcciones: 0 };
  for (const a of acts)
    for (const m of a.modos) {
      if (!m.modo.trim()) continue;
      r.modos++;
      const n = nivelRoe(roe(m.severidad, m.ocurrencia, m.deteccion));
      if (!n) r.sinCalificar++;
      else r[n]++;
      if (n && n !== "bajo" && !m.acciones.trim()) r.sinAcciones++;
    }
  return r;
}

/** Lo guardado, con todos los campos (por si falta alguno). */
export function normalizar(acts: unknown): Actividad[] {
  if (!Array.isArray(acts)) return [];
  const out: Actividad[] = [];
  for (const a of acts) {
    const r = actividadSchema.safeParse({ id: nuevoId(), modos: [], ...(a as object) });
    if (r.success) out.push(r.data);
  }
  return out;
}
