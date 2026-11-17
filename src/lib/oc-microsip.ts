/**
 * Lector de la orden de compra (OC) que sale de Microsip en PDF, para pedir la guia de recoleccion:
 * folio, proveedor y su domicilio (donde se recoge), via de embarque, articulos y subtotal.
 */
import type { TextoPdf } from "@/lib/pegatron-po";

export type OcMicrosip = {
  folio: string | null;
  fecha: string | null;
  proveedor: string | null;
  /** Domicilio del proveedor en un solo texto (para partirDireccion). */
  direccion: string | null;
  /** Renglones del domicilio tal cual (calle, colonia, ciudad y CP). */
  lineas: string[];
  telefono: string | null;
  via: string | null;
  articulos: { clave: string; nombre: string; cantidad: number; unidad: string }[];
  subtotal: number | null;
  moneda: "MXN" | "USD";
};

const MESES: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };
const num = (s: string) => Number(s.replace(/[$,\s]/g, ""));

/** "13/nov./2026" o "13/11/2026" -> "2026-11-13". */
export function fechaMicrosip(s: string): string | null {
  const m = s.trim().toLowerCase().match(/^(\d{1,2})\/([a-z]+\.?|\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mes = /^\d/.test(m[2]) ? Number(m[2]) : MESES[m[2].replace(".", "")];
  if (!mes) return null;
  return `${m[3]}-${String(mes).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export function leerOcMicrosip(textos: TextoPdf[]): OcMicrosip {
  const T = textos.filter((t) => t.pagina === 1);
  const todo = textos.map((t) => t.s).join(" ");
  const et = (re: RegExp) => T.find((t) => re.test(t.s.trim()));
  // Valor justo debajo de una etiqueta (misma columna aproximada).
  const debajo = (lbl: { x: number; y: number } | undefined, ancho = 45) =>
    lbl ? T.filter((t) => t.y < lbl.y - 4 && t.y > lbl.y - 26 && Math.abs(t.x - lbl.x) < ancho).sort((a, b) => b.y - a.y)[0]?.s.trim() ?? null : null;

  const folio = debajo(et(/^Folio$/i));
  const fechaTxt = debajo(et(/^Fecha$/i));
  const via = debajo(et(/^V[ií]a de embarque$/i), 60);

  // Bloque del proveedor: entre la etiqueta "Proveedor" y la fila de "Entrega / Condiciones".
  const hProv = et(/^Proveedor$/i);
  const hCons = et(/^Consignatario$/i);
  const hEntrega = et(/^Entrega$/i);
  let proveedor: string | null = null;
  let direccion: string | null = null;
  let telefono: string | null = null;
  let lineasDom: string[] = [];
  if (hProv) {
    const xMax = hCons ? hCons.x - 20 : 300;
    const yMin = hEntrega ? hEntrega.y + 3 : hProv.y - 90;
    const lineas = T.filter((t) => t.y < hProv.y - 3 && t.y > yMin && t.x < xMax).sort((a, b) => b.y - a.y || a.x - b.x);
    const textosLinea: string[] = [];
    for (const l of lineas) {
      const s = l.s.trim();
      const tel = s.match(/(?:tel[s.:]*|tel[eé]fono:?)\s*([\d\s()+-]{7,})/i);
      if (tel) telefono = tel[1].trim();
      else textosLinea.push(s);
    }
    proveedor = textosLinea[0] ?? null;
    lineasDom = textosLinea.slice(1);
    direccion = lineasDom.join(", ") || null;
  }

  // Articulos: renglones entre el encabezado de la tabla y el Subtotal.
  const hArt = et(/^Art[ií]culo$/i);
  const hSub = et(/^Subtotal$/i);
  const hNom = et(/^Nombre$/i);
  const hUni = et(/^Unidades$/i);
  const hUmed = et(/^U\.?\s?med\.?$/i);
  const articulos: OcMicrosip["articulos"] = [];
  if (hArt && hNom && hUni) {
    const yFin = hSub ? hSub.y + 3 : 0;
    const filas = T.filter((t) => t.y < hArt.y - 4 && t.y > yFin);
    const claves = filas.filter((t) => t.x < hNom.x - 20 && /^[A-Z0-9][A-Z0-9-]{2,}$/i.test(t.s.trim())).sort((a, b) => b.y - a.y);
    claves.forEach((c, k) => {
      const ySig = k + 1 < claves.length ? claves[k + 1].y + 2 : yFin;
      const banda = filas.filter((t) => t.y <= c.y + 2 && t.y > ySig);
      const nombre = banda.filter((t) => t.x >= hNom.x - 100 && t.x < (hUmed?.x ?? hUni.x) - 8 && t !== c).sort((a, b) => b.y - a.y || a.x - b.x).map((t) => t.s.trim()).join(" ");
      const cant = banda.find((t) => Math.abs(t.x - hUni.x - 20) < 30 && /^[\d,.]+$/.test(t.s.trim()));
      const unidad = hUmed ? banda.find((t) => Math.abs(t.x - hUmed.x) < 15)?.s.trim() ?? "" : "";
      if (nombre) articulos.push({ clave: c.s.trim(), nombre: nombre.replace(/\s+/g, " "), cantidad: cant ? num(cant.s) : 0, unidad });
    });
  }

  let subtotal: number | null = null;
  if (hSub) {
    const v = T.filter((t) => Math.abs(t.y - hSub.y) < 3 && t.x > hSub.x + 20 && /^[$\d,.\s]+$/.test(t.s.trim())).sort((a, b) => b.x - a.x)[0];
    if (v) subtotal = num(v.s);
  }
  const moneda: "MXN" | "USD" = /\b(USD|d[oó]lares|U\.?S\.?\s?C(y|ur))/i.test(todo) && !/\bm\.?\s?n\.?\)?/i.test(todo) ? "USD" : "MXN";

  return {
    folio: folio && /^[\w-]{1,20}$/.test(folio) ? folio : null,
    fecha: fechaTxt ? fechaMicrosip(fechaTxt) : null,
    proveedor, direccion, lineas: lineasDom, telefono, via, articulos, subtotal, moneda,
  };
}

/** "50 CAJA Tela encerada ..." para el contenido de la guia. */
export function contenidoOc(oc: OcMicrosip): string {
  return oc.articulos.map((a) => `${a.cantidad ? `${a.cantidad} ${a.unidad} ` : ""}${a.nombre}`.trim()).join("; ").slice(0, 300);
}

/** Domicilio del proveedor en campos: calle, colonia, CP, ciudad y estado. */
export function domicilioOc(oc: OcMicrosip, partir: (t: string) => { calle_numero: string; colonia: string; cp: string; ciudad: string; estado_geo: string }) {
  const l = oc.lineas;
  if (!l.length) return null;
  const ultima = partir(l[l.length - 1]);
  // "NAUCALPAN, EDO MEX CP: 53228": la ciudad es lo que va antes de la primera coma.
  const ciudad = ultima.ciudad || titulo(l[l.length - 1].split(",")[0].replace(/\bC\.?P\.?:?\s*\d{5}\b/i, "").trim());
  if (l.length >= 3) return { calle_numero: l[0], colonia: l.slice(1, -1).join(", "), cp: ultima.cp, ciudad, estado_geo: ultima.estado_geo };
  const todo = partir(l.join(", "));
  return todo;
}

const titulo = (t: string) => t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
