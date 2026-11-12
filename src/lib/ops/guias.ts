import { z } from "zod";

export const PAQUETERIAS = ["Paquete Express", "Estafeta", "Tinypack", "Porteo", "DHL", "Otra"] as const;
export type Paqueteria = (typeof PAQUETERIAS)[number];
export const SERVICIOS = { estandar: "Estándar", express: "Express", dia_siguiente: "Día siguiente", economico: "Económico / terrestre" } as const;
export type Servicio = keyof typeof SERVICIOS;

export const GUIA_ESTADOS = {
  solicitada: { label: "Solicitada", chip: "bg-amber-100 text-amber-900", step: 0 },
  en_proceso: { label: "Generando", chip: "bg-sky-100 text-sky-900", step: 1 },
  requiere_datos: { label: "Faltan datos", chip: "bg-red-100 text-red-800", step: 1 },
  lista: { label: "Lista", chip: "bg-green-100 text-green-800", step: 2 },
  cancelada: { label: "Cancelada", chip: "bg-slate-200 text-slate-700", step: -1 },
} as const;
export type GuiaEstado = keyof typeof GUIA_ESTADOS;

/** Titulo de la guia: factura, persona o negocio y paqueteria. */
export function guiaTitle(g: { factura: string; destinatario: string; paqueteria: string; paqueteria_otra?: string | null }) {
  return `${g.factura} · ${g.destinatario} · ${g.paqueteria === "Otra" ? g.paqueteria_otra || "Otra" : g.paqueteria}`;
}

/** Las guias se atienden rapido: alarma a la hora y alerta roja fuerte a las 2 horas. */
export const AMBAR_AFTER_HOURS = 1;
export const ALERT_AFTER_HOURS = 2;
export const REMIND_AFTER_HOURS = 1;

/** Horas que lleva pendiente (desde que se pidio o se corrigieron los datos). */
export function hoursPending(g: { estado: GuiaEstado; solicitada_at: string }, now: Date): number | null {
  if (g.estado !== "solicitada" && g.estado !== "en_proceso") return null;
  return (now.getTime() - new Date(g.solicitada_at).getTime()) / 3_600_000;
}

/** Alerta visual: ambar a la hora, roja (fuerte) a las 2 horas. */
export function guiaAlert(g: { estado: GuiaEstado; solicitada_at: string }, now: Date): "roja" | "ambar" | null {
  const h = hoursPending(g, now);
  if (h === null) return null;
  if (h >= ALERT_AFTER_HOURS) return "roja";
  if (h >= AMBAR_AFTER_HOURS) return "ambar";
  return null;
}

/** El vendedor puede recordar a partir de 1 hora y maximo una vez por hora. */
export function canRemind(g: { estado: GuiaEstado; solicitada_at: string; ultimo_recordatorio_at: string | null }, now: Date): { ok: boolean; reason?: string } {
  const h = hoursPending(g, now);
  if (h === null) return { ok: false, reason: "La guía ya no está pendiente" };
  if (h < REMIND_AFTER_HOURS) {
    const m = Math.ceil((REMIND_AFTER_HOURS - h) * 60);
    return { ok: false, reason: `Podrás recordar en ${m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`}` };
  }
  if (g.ultimo_recordatorio_at && now.getTime() - new Date(g.ultimo_recordatorio_at).getTime() < 3_600_000) {
    return { ok: false, reason: "Ya recordaste hace menos de una hora" };
  }
  return { ok: true };
}

export function elapsedText(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.floor(h)} h`;
  return `${Math.floor(h / 24)} días`;
}

// Acepta vacio, null o undefined (lo guardado viene como null).
const txt = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
/** "$3,480.00", "120 cm", "5 kg", "1.5" -> numero; vacio -> null. */
export function limpiaNumero(v: unknown): number | null | unknown {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v !== "string") return v;
  const s = v.replace(/\$|mxn|usd|cms?|kgs?|kilos?|\s/gi, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
  return s === "" ? null : Number(s);
}
const num = (msg: string) => z.preprocess(limpiaNumero, z.number({ message: msg }).positive(msg).nullable()).optional().transform((v) => v ?? null);
const numReq = (msg: string, pos = true) => z.preprocess(limpiaNumero, pos ? z.number({ message: msg }).positive(msg) : z.number({ message: msg }).min(0, msg));

/** Una partida del envio: N tarimas o bultos iguales (mismo peso y medidas). */
export const partidaSchema = z.object({
  empaque: z.enum(["bulto", "tarima"], { message: "Elige bulto o tarima" }).default("bulto"),
  cantidad: z.preprocess(limpiaNumero, z.number({ message: "Escribe cuántos van en cada partida" }).int("La cantidad va en número entero").min(1, "Mínimo 1 por partida").max(999)),
  peso_kg: numReq("Escribe el peso de cada pieza en kg (solo el número)"),
  largo_cm: num("Largo inválido: escribe solo el número en cm"),
  ancho_cm: num("Ancho inválido: escribe solo el número en cm"),
  alto_cm: num("Alto inválido: escribe solo el número en cm"),
  descripcion: txt(150),
});
export type Partida = z.infer<typeof partidaSchema>;
export type PartidaInput = z.input<typeof partidaSchema>;

/** Totales de las partidas para las columnas de resumen de la guia. */
export function totalesPartidas(ps: Partida[]) {
  const tipos = new Set(ps.map((p) => p.empaque));
  const bultos = Math.min(999, ps.reduce((a, p) => a + p.cantidad, 0));
  const peso = Math.round(ps.reduce((a, p) => a + p.cantidad * p.peso_kg, 0) * 100) / 100;
  const una = ps.length === 1 ? ps[0] : null;
  return {
    empaque: (tipos.size > 1 ? "mixto" : [...tipos][0]) as "bulto" | "tarima" | "mixto",
    bultos,
    peso_kg: peso,
    largo_cm: una?.largo_cm ?? null,
    ancho_cm: una?.ancho_cm ?? null,
    alto_cm: una?.alto_cm ?? null,
  };
}

/** "2 tarimas y 3 bultos". */
export function resumenPartidas(ps: { empaque: string; cantidad: number }[]) {
  const t = ps.filter((p) => p.empaque === "tarima").reduce((a, p) => a + p.cantidad, 0);
  const b = ps.filter((p) => p.empaque !== "tarima").reduce((a, p) => a + p.cantidad, 0);
  return [t ? empaqueLabel("tarima", t) : "", b ? empaqueLabel("bulto", b) : ""].filter(Boolean).join(" y ");
}

/** Las partidas guardadas, o una partida armada con los datos de antes (guias viejas). */
export function partidasDeGuia(g: { partidas?: unknown; empaque?: string | null; bultos: number; peso_kg: number | string; largo_cm?: number | string | null; ancho_cm?: number | string | null; alto_cm?: number | string | null }): Partida[] {
  if (Array.isArray(g.partidas)) {
    const out = g.partidas.map((p) => partidaSchema.safeParse(p)).filter((r) => r.success).map((r) => r.data);
    if (out.length) return out;
  }
  const n = Math.max(1, Number(g.bultos) || 1);
  return [{
    empaque: g.empaque === "tarima" ? "tarima" : "bulto",
    cantidad: n,
    peso_kg: Math.max(0.01, Math.round((Number(g.peso_kg) / n) * 100) / 100),
    largo_cm: g.largo_cm == null ? null : Number(g.largo_cm),
    ancho_cm: g.ancho_cm == null ? null : Number(g.ancho_cm),
    alto_cm: g.alto_cm == null ? null : Number(g.alto_cm),
    descripcion: null,
  }];
}

export const guiaSchema = z
  .object({
    factura: z.string().trim().min(1, "Escribe la factura").max(60),
    destinatario: z.string().trim().min(2, "Escribe la persona o negocio").max(200),
    paqueteria: z.enum(PAQUETERIAS, { message: "Elige la paquetería" }),
    paqueteria_otra: txt(80),
    servicio: z.enum(Object.keys(SERVICIOS) as [Servicio, ...Servicio[]], { message: "Elige el servicio" }),
    customer_id: z.preprocess((v) => v || null, z.string().uuid("Cliente inválido: vuelve a elegirlo").nullable()).optional().transform((v) => v ?? null),
    contacto_nombre: z.string({ message: "Escribe el nombre de quien recibe" }).trim().min(2, "Escribe el nombre de quien recibe").max(150),
    telefono: z.string().trim().min(7, "Escribe el teléfono de quien recibe").max(40),
    correo: z.preprocess((v) => (typeof v === "string" ? v.trim() : v) || null, z.string().email("El correo no es válido (o déjalo vacío)").max(150).nullable()).optional().transform((v) => v ?? null),
    calle_numero: z.string().trim().min(3, "Escribe calle y número").max(250),
    colonia: txt(150),
    cp: z.preprocess((v) => (typeof v === "string" ? v.replace(/\D/g, "") : v), z.string().regex(/^\d{5}$/, "El código postal es de 5 dígitos")),
    ciudad: z.string().trim().min(2, "Escribe la ciudad").max(120),
    estado_geo: z.string().trim().min(2, "Elige el estado").max(60),
    referencias: txt(300),
    partidas: z.array(partidaSchema, { message: "Agrega al menos una partida" }).min(1, "Agrega al menos una partida").max(30, "Máximo 30 partidas"),
    contenido: txt(300),
    valor_declarado: z.preprocess(limpiaNumero, z.number({ message: "Valor declarado inválido: escribe solo el número" }).min(0).nullable()).optional().transform((v) => v ?? null),
    valor_moneda: z.enum(["MXN", "USD"]).default("MXN"),
    asegurar: z.boolean().default(false),
    urgente: z.boolean().default(false),
    notas: txt(1000),
  })
  .refine((v) => v.paqueteria !== "Otra" || !!v.paqueteria_otra, { message: "Escribe cuál paquetería", path: ["paqueteria_otra"] })
  .transform((v) => ({ ...v, ...totalesPartidas(v.partidas) }));
export type GuiaInput = z.input<typeof guiaSchema>;

export const GUIA_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg"];

/** "3 bultos", "1 tarima". */
export const empaqueLabel = (empaque: string | null | undefined, n: number) =>
  empaque === "mixto" ? `${n} piezas (tarimas y bultos)` : `${n} ${empaque === "tarima" ? (n === 1 ? "tarima" : "tarimas") : n === 1 ? "bulto" : "bultos"}`;

// ---------------------------------------------------------------------------
// Direccion en un solo texto (como viene en la factura o en el cliente) -> campos de la guia.
// ---------------------------------------------------------------------------
const ESTADOS_ABREV: [RegExp, string][] = [
  [/\bCHIH(UAHUA)?\b\.?/i, "Chihuahua"], [/\bCOAH(UILA)?\b\.?/i, "Coahuila"], [/\bN\.?\s?L\.?\b|NUEVO LE[OÓ]N/i, "Nuevo León"],
  [/\bSON(ORA)?\b\.?/i, "Sonora"], [/\bDGO\b\.?|DURANGO/i, "Durango"], [/\bJAL(ISCO)?\b\.?/i, "Jalisco"], [/\bB\.?C\.?\b|BAJA CALIFORNIA/i, "Baja California"],
  [/\bCDMX\b|CIUDAD DE M[EÉ]XICO|\bD\.?F\.?\b/i, "Ciudad de México"], [/\bQRO\b\.?|QUER[EÉ]TARO/i, "Querétaro"], [/\bGTO\b\.?|GUANAJUATO/i, "Guanajuato"],
  [/\bTAMPS?\b\.?|TAMAULIPAS/i, "Tamaulipas"], [/\bSIN(ALOA)?\b\.?/i, "Sinaloa"], [/\bEDO\.?\s?MEX\b\.?|ESTADO DE M[EÉ]XICO/i, "Estado de México"],
  [/\bAGS\b\.?|AGUASCALIENTES/i, "Aguascalientes"], [/\bSLP\b|SAN LUIS POTOS[IÍ]/i, "San Luis Potosí"], [/\bPUE(BLA)?\b\.?/i, "Puebla"],
];

/** "MARIANO GUILLEN No. 9021, COL. LOS PINOS, CHIHUAHUA, CHIH. CP: 31416" -> calle, colonia, cp, ciudad y estado (lo que se pueda). */
export function partirDireccion(texto: string | null | undefined) {
  const out = { calle_numero: "", colonia: "", cp: "", ciudad: "", estado_geo: "" };
  let t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return out;
  // Codigo postal: el que dice "C.P."; si no, 5 digitos sueltos al final (no el numero de la calle).
  const cp = t.match(/C\.?\s?P\.?\s*:?\s*(\d{5})\b/i) ?? t.match(/(?:^|[,;]\s*|\s)(\d{5})\s*$/);
  if (cp) {
    out.cp = cp[1];
    t = t.replace(cp[0], "");
  }
  const partes = t.split(/\s*[,;]\s*/).map((x) => x.trim()).filter((x) => x && !/^[-.:]+$/.test(x));
  const resto: string[] = [];
  // El estado es el ULTIMO trozo que lo nombra ("CHIHUAHUA, CHIH."): el anterior es la ciudad.
  const conEstado = partes.map((x) => ESTADOS_ABREV.find(([re]) => re.test(x)));
  const iEst = conEstado.map((e, i) => (e ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  partes.forEach((x, i) => {
    if (!out.colonia && /^(COL(ONIA)?|FRACC(IONAMIENTO)?|PARQUE IND(USTRIAL)?)\b\.?/i.test(x)) {
      out.colonia = x.replace(/^COL(ONIA)?\.?\s*/i, "").trim();
      return;
    }
    if (i === iEst) {
      const est = conEstado[i]!;
      out.estado_geo = est[1];
      const ciudad = x.replace(est[0], "").replace(/[.,\s]+$/, "").trim();
      if (ciudad && !out.ciudad) out.ciudad = ciudad;
      return;
    }
    if (conEstado[i] && !/\d/.test(x) && !out.ciudad) {
      out.ciudad = x;
      return;
    }
    resto.push(x);
  });
  // Lo que queda: la calle primero; si sobra un texto sin numero al final, es la ciudad.
  if (!out.ciudad && resto.length > 1 && !/\d/.test(resto[resto.length - 1])) out.ciudad = resto.pop()!;
  out.calle_numero = resto.join(", ");
  const titulo = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase()) : s);
  out.ciudad = titulo(out.ciudad);
  return out;
}
