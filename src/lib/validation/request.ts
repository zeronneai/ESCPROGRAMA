import { z } from "zod";

export const UNIDADES = ["pieza", "caja", "paquete", "par", "kg", "litro", "metro", "otra"] as const;
export type Unidad = (typeof UNIDADES)[number];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const uuid = z.string().uuid();

export const referenceSchema = z.object({
  id: uuid,
  tipo: z.enum(["imagen", "link"]),
  url: z.string().min(1),
});
export type ReferenceInput = z.infer<typeof referenceSchema>;

/** Valor numerico de un campo de texto ("1,250.5" -> 1250.5); undefined si esta vacio. */
export function parseNumber(v: string | number | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const t = String(v).trim().replace(/,/g, "");
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ---- Borrador: permisivo, solo cuida tipos y formato -----------------------
export const itemDraftSchema = z.object({
  id: uuid,
  producto: z.string().default(""),
  descripcion: z.string().default(""),
  cantidad: z.string().default(""),
  unidad: z.string().default(""),
  talla: z.string().default(""),
  notas: z.string().default(""),
  refs: z.array(referenceSchema).default([]),
});
export type ItemDraft = z.infer<typeof itemDraftSchema>;

export const requestDraftSchema = z.object({
  request_id: uuid,
  customer_id: uuid,
  notas: z.string().default(""),
  atencion: z.string().max(200).default(""),
  destino_entrega: z.string().max(300).default(""),
  items: z.array(itemDraftSchema).max(100),
});
export type RequestDraft = z.infer<typeof requestDraftSchema>;

// ---- Envio: reglas obligatorias --------------------------------------------
export interface Problem {
  /** Indice de partida (0-based) o null si es de la solicitud. */
  item: number | null;
  field: "customer" | "items" | "producto" | "descripcion" | "cantidad" | "referencias";
  message: string;
}

/** Lista exacta de lo que falta para poder enviar. Vacia = se puede enviar. */
export function submitProblems(req: {
  customer_id?: string | null;
  items: Array<Partial<Omit<ItemDraft, "refs">> & { refs?: Array<{ tipo: string; url: string }> }>;
}): Problem[] {
  const out: Problem[] = [];
  if (!req.customer_id) out.push({ item: null, field: "customer", message: "Elige el cliente" });
  if (req.items.length === 0) {
    out.push({ item: null, field: "items", message: "Agrega al menos una partida" });
  }
  req.items.forEach((it, i) => {
    const n = i + 1;
    if (!it.producto?.trim()) out.push({ item: i, field: "producto", message: `Partida ${n}: falta el nombre del producto` });
    if ((it.descripcion ?? "").trim().length < 10) {
      out.push({ item: i, field: "descripcion", message: `Partida ${n}: la descripcion o uso (interno) necesita al menos 10 caracteres` });
    }
    const qty = parseNumber(it.cantidad);
    const hasQty = qty !== undefined;
    const hasSize = !!it.talla?.trim();
    if (hasQty && !(qty > 0)) {
      out.push({ item: i, field: "cantidad", message: `Partida ${n}: la cantidad debe ser mayor a 0` });
    } else if (hasQty && !it.unidad) {
      out.push({ item: i, field: "cantidad", message: `Partida ${n}: elige la unidad` });
    } else if (!hasQty && !hasSize) {
      out.push({ item: i, field: "cantidad", message: `Partida ${n}: captura cantidad o talla` });
    }
    const refs = it.refs ?? [];
    if (refs.length === 0) {
      out.push({ item: i, field: "referencias", message: `Partida ${n}: agrega una imagen o un link de referencia` });
    }
  });
  return out;
}

/** Revisa formato de unidades y links (aplica tambien a borradores). */
export function formatProblems(req: { items: Array<Partial<ItemDraft>> }): string[] {
  const out: string[] = [];
  req.items.forEach((it, i) => {
    const n = i + 1;
    const qty = parseNumber(it.cantidad);
    if (qty !== undefined && !(qty > 0)) out.push(`Partida ${n}: cantidad invalida`);
    if (it.unidad && !(UNIDADES as readonly string[]).includes(it.unidad)) out.push(`Partida ${n}: unidad invalida`);
    if (qty !== undefined && !it.unidad && qty > 0) out.push(`Partida ${n}: elige la unidad`);
    for (const r of it.refs ?? []) {
      if (r.tipo === "link" && !isHttpUrl(r.url)) out.push(`Partida ${n}: el link no es valido (debe iniciar con http:// o https://)`);
    }
  });
  return out;
}

/** Payload para la RPC save_draft. */
export function toDraftPayload(d: RequestDraft) {
  return {
    request_id: d.request_id,
    customer_id: d.customer_id,
    notas: d.notas,
    atencion: d.atencion,
    destino_entrega: d.destino_entrega,
    items: d.items.map((i) => ({
      id: i.id,
      producto: i.producto,
      descripcion: i.descripcion,
      cantidad: parseNumber(i.cantidad) ?? null,
      unidad: parseNumber(i.cantidad) === undefined ? null : i.unidad || null,
      talla: i.talla,
      notas: i.notas,
      refs: i.refs.map((r) => ({ id: r.id, tipo: r.tipo, url: r.tipo === "link" ? r.url.trim() : r.url })),
    })),
  };
}
