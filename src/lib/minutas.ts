import { z } from "zod";

/** Un paso de la minuta: tema, explicacion, lo que hay que hacer, a quien aplica y para cuando. */
export interface MinutaPunto {
  tema: string;
  explicacion: string;
  actividad: string;
  aplica: string;
  fecha: string;
}
export interface MinutaExterno {
  nombre: string;
  puesto: string;
  correo: string;
}

export interface MinutaRow {
  id: string;
  numero: string;
  tema: string;
  responsable: string | null;
  lugar: string | null;
  fecha: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  desarrollo: MinutaPunto[];
  externos: MinutaExterno[];
  proxima_tema: string | null;
  proxima_fecha: string | null;
  proxima_hora: string | null;
  proxima_lugar: string | null;
  estado: "borrador" | "enviada";
  enviada_at: string | null;
  created_by: string;
  created_by_nombre: string | null;
  created_at: string;
}
export interface MinutaFirma {
  minuta_id: string;
  user_id: string;
  nombre: string | null;
  puesto: string | null;
  correo: string | null;
  firmada_at: string | null;
}

export const MINUTA_COLS =
  "id, numero, tema, responsable, lugar, fecha, hora_inicio, hora_fin, desarrollo, externos, proxima_tema, proxima_fecha, proxima_hora, proxima_lugar, estado, enviada_at, created_by, created_by_nombre, created_at";

const txt = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`).optional().transform((v) => v || null);
const hora = z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Hora inválida")]).optional().transform((v) => v || null);
const fechaOpt = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")]).optional().transform((v) => v || null);

export const puntoSchema = z.object({
  tema: z.string().trim().min(2, "Escribe el tema de cada punto").max(200),
  explicacion: z.string().trim().max(3000).default(""),
  actividad: z.string().trim().max(1000).default(""),
  aplica: z.string().trim().max(200).default(""),
  fecha: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")]).default(""),
});
export const externoSchema = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre del asistente").max(150),
  puesto: z.string().trim().max(120).default(""),
  correo: z.string().trim().max(150).default(""),
});

export const minutaSchema = z.object({
  tema: z.string().trim().min(3, "Escribe el tema de la reunión").max(200),
  responsable: txt(150),
  lugar: txt(200),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  hora_inicio: hora,
  hora_fin: hora,
  desarrollo: z.array(puntoSchema).min(1, "Agrega al menos un punto").max(40),
  externos: z.array(externoSchema).max(40),
  proxima_tema: txt(200),
  proxima_fecha: fechaOpt,
  proxima_hora: hora,
  proxima_lugar: txt(200),
});
export type MinutaInput = z.input<typeof minutaSchema>;

export const PUNTO_VACIO: MinutaPunto = { tema: "", explicacion: "", actividad: "", aplica: "", fecha: "" };

export const horaCorta = (h: string | null) => (h ? h.slice(0, 5) : "");
export const fechaMx = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "");

/** Estado para la lista: borrador, por firmar (faltan) o firmada por todos. */
export function minutaEstado(m: Pick<MinutaRow, "estado">, firmas: Pick<MinutaFirma, "firmada_at">[]): { label: string; cls: string } {
  if (m.estado === "borrador") return { label: "Borrador", cls: "bg-slate-100 text-slate-700" };
  const faltan = firmas.filter((f) => !f.firmada_at).length;
  if (faltan) return { label: `Faltan ${faltan} firma(s)`, cls: "bg-amber-100 text-amber-900" };
  return { label: "Firmada", cls: "bg-green-100 text-green-800" };
}
