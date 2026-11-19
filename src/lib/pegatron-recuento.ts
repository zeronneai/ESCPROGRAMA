/** Recuento por articulo de lo que falta por pedir en los pedidos de Pegatron. */

const CLAVE_RE = /\b(?:ESC-[A-Z0-9][A-Z0-9.\-/]*|MSR-65P?(?![A-Z0-9]))/i;

/** Clave ESC que viene en el texto del articulo ("ESC-GNPF-L · Guante..."), o null. */
export function claveDeArticulo(texto: string): string | null {
  const m = texto.match(CLAVE_RE);
  return m ? m[0].toUpperCase().replace(/[.,;:]+$/, "") : null;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

export interface LineaRecuento {
  id: string;
  articulo_esc: string;
  cantidad: number | string;
  unidad: string | null;
  entrega?: string | null;
  pedido_at: string | null;
  po: string;
  oc_id: string;
}

export interface FilaRecuento {
  clave: string | null;
  articulo: string;
  cantidades: { unidad: string; total: number }[];
  ocs: { id: string; po: string }[];
  entrega: string | null;
  lineas: string[];
}

/** Agrupa los renglones pendientes por articulo (por clave si la tiene, si no por el texto). */
export function recuentoPorArticulo(lineas: LineaRecuento[]): FilaRecuento[] {
  const mapa = new Map<string, FilaRecuento>();
  for (const l of lineas) {
    if (l.pedido_at) continue;
    const clave = claveDeArticulo(l.articulo_esc);
    const key = clave ?? norm(l.articulo_esc);
    const f = mapa.get(key) ?? { clave, articulo: l.articulo_esc, cantidades: [], ocs: [], entrega: null, lineas: [] };
    const u = (l.unidad ?? "").trim().toUpperCase() || "PZA";
    const c = f.cantidades.find((x) => x.unidad === u);
    if (c) c.total += Number(l.cantidad);
    else f.cantidades.push({ unidad: u, total: Number(l.cantidad) });
    if (!f.ocs.some((o) => o.id === l.oc_id)) f.ocs.push({ id: l.oc_id, po: l.po });
    if (l.entrega && (!f.entrega || l.entrega < f.entrega)) f.entrega = l.entrega;
    f.lineas.push(l.id);
    mapa.set(key, f);
  }
  return [...mapa.values()].sort((a, b) => (a.entrega ?? "9999").localeCompare(b.entrega ?? "9999") || a.articulo.localeCompare(b.articulo));
}
