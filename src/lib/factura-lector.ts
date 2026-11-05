/**
 * Lector de facturas (CFDI) de ESC: saca el folio, el cliente y los articulos con clave ESC-... y su cantidad.
 * Funciona con el texto del PDF (renglones reconstruidos por posicion) o con el XML del CFDI.
 * Es "mejor esfuerzo": el usuario revisa y corrige antes de guardar.
 */

export interface LineaFactura {
  clave: string | null;
  descripcion: string;
  unidad: string | null;
  cantidad: number | null;
}
export interface FacturaLeida {
  folio: string | null;
  fecha: string | null;
  cliente: string | null;
  vendedor: string | null;
  lineas: LineaFactura[];
  avisos: string[];
}

const ESC_RE = /\bESC-[A-Z0-9][A-Z0-9.\-/]*/i;
const NUM_RE = /^-?[\d,]+(?:\.\d+)?$/;
const num = (s: string) => Number(s.replace(/,/g, ""));
const limpiar = (s: string) => s.replace(/\s+/g, " ").trim();

/** De los numeros al final del renglon: ...unidades, precio, [descuento], importe. */
function cantidadDeNumeros(nums: number[]): number | null {
  if (nums.length < 3) return null;
  const importe = nums[nums.length - 1];
  for (let k = nums.length - 3; k >= 0; k--) {
    const u = nums[k];
    const p = nums[k + 1];
    const descuentos = nums.slice(k + 2, nums.length - 1).reduce((a, x) => a + x, 0);
    if (u > 0 && Number.isFinite(u) && Math.abs(u * p - descuentos - importe) <= Math.max(0.05, importe * 0.001)) return u;
  }
  return null;
}

/** Texto del PDF ya separado en renglones; dentro del renglon, columnas separadas por 2+ espacios. */
export function leerFacturaTexto(renglones: string[]): FacturaLeida {
  const lines = renglones.map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  const todo = lines.join("\n");
  const avisos: string[] = [];

  let folio = todo.match(/Serie y folio:\s*([A-Z0-9-]+)/i)?.[1] ?? null;
  if (!folio) {
    const i = lines.findIndex((l) => /(^|\s)Folio\s*$/i.test(l));
    if (i >= 0) folio = lines.slice(i + 1, i + 3).map((l) => l.trim()).find((l) => /^[A-Z]{0,4}-?\d{1,10}$/i.test(l)) ?? null;
  }
  const fecha = todo.match(/emisi[oó]n:\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;

  let cliente: string | null = null;
  let vendedor: string | null = null;
  const ci = lines.findIndex((l) => /^\s*Cliente\b/i.test(l.trim()));
  if (ci >= 0 && lines[ci + 1]) {
    const partes = lines[ci + 1].trim().split(/\s{2,}/);
    cliente = limpiar(partes.join(" · "));
    if (/Vendedor/i.test(lines[ci])) {
      const cand = lines[ci + 2]?.trim();
      if (cand && /^[A-ZÁÉÍÓÚÑ .]{3,40}$/.test(cand)) vendedor = cand;
    }
  }

  const lineas: LineaFactura[] = [];
  for (let i = 0; i < lines.length; i++) {
    const tokens = lines[i].trim().split(/\s{2,}/);
    if (!/^\d{8}$/.test(tokens[0] ?? "")) continue; // la partida empieza con la clave SAT (8 digitos)
    let fin = tokens.length;
    const nums: number[] = [];
    while (fin > 1 && NUM_RE.test(tokens[fin - 1])) {
      nums.unshift(num(tokens[fin - 1]));
      fin--;
    }
    const medio = tokens.slice(1, fin).filter((t) => !/^\d{3}-(IVA|IEPS|ISR)$/i.test(t));
    const unidad = medio.length > 1 && /^[A-Z0-9]{2,3}\b/.test(medio[0]) ? medio.shift()! : null;
    let descripcion = medio.join(" ");
    let clave = descripcion.match(ESC_RE)?.[0] ?? null;
    // El renglon siguiente trae la clave ESC-... y el resto de la descripcion.
    for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
      const t = lines[j].trim();
      if (/^\d{8}\s{2}/.test(t) || /^(Cadena|Sello|IMPORTE|Subtotal)/i.test(t)) break;
      const m = t.match(ESC_RE);
      if (m && !clave) clave = m[0];
      const resto = t.replace(ESC_RE, "").trim();
      if (resto && !NUM_RE.test(resto)) descripcion = `${descripcion}${/[a-z]$/i.test(descripcion) && /^[a-z]/.test(resto) ? "" : " "}${resto}`;
      if (m) break;
    }
    const cantidad = cantidadDeNumeros(nums);
    if (cantidad === null) avisos.push(`No pude leer la cantidad de ${clave ?? descripcion.slice(0, 40)}`);
    lineas.push({ clave: clave ? clave.toUpperCase() : null, descripcion: limpiar(descripcion), unidad: unidad ? limpiar(unidad) : null, cantidad });
  }

  if (!lineas.length) {
    const claves = [...new Set((todo.match(new RegExp(ESC_RE.source, "gi")) ?? []).map((c) => c.toUpperCase()))];
    for (const c of claves) lineas.push({ clave: c, descripcion: "", unidad: null, cantidad: null });
    avisos.push(claves.length ? "No reconocí la tabla de partidas: revisa las cantidades." : "No encontré artículos en la factura.");
  }
  if (!folio) avisos.push("No encontré el folio: escríbelo.");
  return { folio: folio ? folio.toUpperCase() : null, fecha, cliente, vendedor, lineas, avisos };
}

/** XML del CFDI (3.3 o 4.0). Mas confiable que el PDF. */
export function leerFacturaXml(xml: string): FacturaLeida {
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
  const dec = (s: string | null) => (s ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const comp = xml.match(/<(?:\w+:)?Comprobante\b[^>]*>/)?.[0] ?? "";
  const receptor = xml.match(/<(?:\w+:)?Receptor\b[^>]*>/)?.[0] ?? "";
  const serie = attr(comp, "Serie") ?? "";
  const folioN = attr(comp, "Folio");
  const lineas: LineaFactura[] = [];
  for (const c of xml.match(/<(?:\w+:)?Concepto\b[^>]*>/g) ?? []) {
    const ident = dec(attr(c, "NoIdentificacion"));
    const desc = dec(attr(c, "Descripcion"));
    const clave = (ident.match(ESC_RE) ?? desc.match(ESC_RE))?.[0] ?? null;
    const cant = Number(attr(c, "Cantidad"));
    lineas.push({
      clave: clave ? clave.toUpperCase() : null,
      descripcion: limpiar(desc),
      unidad: attr(c, "Unidad") ?? attr(c, "ClaveUnidad"),
      cantidad: Number.isFinite(cant) && cant > 0 ? cant : null,
    });
  }
  const avisos: string[] = [];
  if (!comp) avisos.push("El archivo no parece un CFDI.");
  if (!lineas.length) avisos.push("El XML no tiene conceptos.");
  return {
    folio: folioN ? `${serie}${folioN}`.toUpperCase() : null,
    fecha: attr(comp, "Fecha")?.slice(0, 10) ?? null,
    cliente: dec(attr(receptor, "Nombre")) || null,
    vendedor: null,
    lineas,
    avisos,
  };
}

/** Renglones de un PDF a partir de los elementos de texto de pdf.js (agrupados por altura, ordenados por x). */
export function renglonesDeItems(items: { str: string; transform: number[] }[]): string[] {
  const rows = new Map<number, { x: number; s: string }[]>();
  for (const it of items) {
    if (!it.str?.trim()) continue;
    const y = Math.round(it.transform[5] / 2) * 2;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y)!.push({ x: it.transform[4], s: it.str.trim() });
  }
  return [...rows.keys()].sort((a, b) => b - a).map((y) => rows.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join("  "));
}
