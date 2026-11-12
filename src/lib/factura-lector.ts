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
  /** Datos para registrar la venta y dar de alta al cliente (lo que se pudo leer). */
  uuid?: string | null;
  rfc?: string | null;
  razonSocial?: string | null;
  nombreComercial?: string | null;
  direccion?: string | null;
  /** Domicilio de entrega (columna de en medio en el PDF de ESC): otro lugar del mismo cliente. */
  entrega?: { nombre: string | null; direccion: string } | null;
  telefono?: string | null;
  moneda?: "MXN" | "USD" | null;
  metodo?: "PUE" | "PPD" | null;
  condiciones?: string | null;
  pago?: "contado" | "credito" | null;
  diasCredito?: number | null;
  vence?: string | null;
  subtotal?: number | null;
  total?: number | null;
}

/** Celda de texto con su posicion horizontal (para separar columnas). */
export type Celda = { x: number; s: string };

const RFC_RE = /\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/;
const UUID_RE = /\b([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\b/i;

/** Contado o credito (y dias) a partir del metodo de pago, las condiciones y la fecha de vencimiento. */
export function pagoDe(metodo: string | null | undefined, condiciones: string | null | undefined, fecha: string | null, vence: string | null): { pago: "contado" | "credito" | null; dias: number | null } {
  const c = (condiciones ?? "").toUpperCase();
  const dc = c.match(/(\d{1,3})\s*D[IÍ]AS/);
  if (/CR[EÉ]DITO/.test(c) || (dc && !/CONTADO/.test(c))) return { pago: "credito", dias: dc ? Number(dc[1]) : diasEntre(fecha, vence) };
  if (/CONTADO|INMEDIATO/.test(c)) return { pago: "contado", dias: null };
  if (metodo === "PPD") return { pago: "credito", dias: diasEntre(fecha, vence) };
  if (metodo === "PUE") return { pago: "contado", dias: null };
  return { pago: null, dias: null };
}

function diasEntre(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d = Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
  return d >= 1 && d <= 365 ? d : null;
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
export function leerFacturaTexto(renglones: string[], filas?: Celda[][]): FacturaLeida {
  const keep = renglones.map((l, i) => ({ l: l.replace(/\s+$/, ""), f: filas?.[i] })).filter((r) => r.l.trim());
  const lines = keep.map((r) => r.l);
  const celdas = keep.map((r) => r.f);
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

  // El vendedor puede venir en el mismo renglon que el cliente, en la columna de "Vendedor".
  if (!vendedor && ci >= 0) {
    const xv = celdas[ci]?.find((k) => /Vendedor/i.test(k.s))?.x;
    const cand = xv !== undefined ? celdas[ci + 1]?.find((k) => Math.abs(k.x - xv) < 40)?.s.trim() : undefined;
    if (cand && /^[A-ZÁÉÍÓÚÑ .]{3,40}$/.test(cand)) vendedor = cand;
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

  // --- Datos del cliente y de cobranza
  const partes = ci >= 0 && lines[ci + 1] ? lines[ci + 1].trim().split(/\s{2,}/) : [];
  const razonSocial = partes[0] ? limpiar(partes[0]) : null;
  const nombreComercial = partes[1] && partes[1] !== vendedor ? limpiar(partes[1]) : null;
  const ri = ci >= 0 ? lines.findIndex((l, i) => i > ci && /\bRFC\s*:/i.test(l)) : -1;
  const rfc = ri >= 0 ? (lines[ri].toUpperCase().replace(/[\s.-]/g, "").match(RFC_RE)?.[1] ?? null) : null;
  const ETIQ = /^(Condiciones|Orden de compra|Vendedor|Cliente|CR[EÉ]DITO\b|CONTADO\b|R[ée]gimen)/i;
  let direccion: string | null = null;
  if (ci >= 0 && ri > ci) {
    const x0 = celdas[ci + 1]?.[0]?.x;
    const trozos: string[] = [];
    for (let i = ci + 2; i < ri; i++) {
      if (x0 !== undefined && celdas[i]) {
        // Solo la columna del cliente (la de la izquierda); la otra es la direccion de entrega.
        const c = celdas[i]!.find((k) => Math.abs(k.x - x0) < 25);
        if (c && !ETIQ.test(c.s.trim())) trozos.push(c.s.trim());
      } else {
        const t = lines[i].trim().split(/\s{2,}/)[0];
        if (t && t !== vendedor && !ETIQ.test(t)) trozos.push(t);
      }
    }
    direccion = trozos.length ? limpiar(trozos.join(", ")) : null;
  }
  // Domicilio de entrega: la columna de en medio (entre el cliente y "Vendedor").
  let entrega: FacturaLeida["entrega"] = null;
  const x0c = ci >= 0 ? celdas[ci + 1]?.[0]?.x : undefined;
  if (ci >= 0 && x0c !== undefined) {
    const xVend = celdas[ci]?.find((k) => /Vendedor/i.test(k.s))?.x ?? Infinity;
    const enMedio = (k: Celda) => k.x > x0c + 80 && k.x < xVend - 60;
    const nombreE = celdas[ci + 1]?.find(enMedio)?.s.trim() || null;
    const trozos: string[] = [];
    for (let i = ci + 2; i < lines.length; i++) {
      if (/^\s*(Clave SAT|R[ée]gimen)/i.test(lines[i]) || /^\d{8}\b/.test(lines[i].trim())) break;
      for (const k of celdas[i] ?? []) if (enMedio(k) && !ETIQ.test(k.s.trim())) trozos.push(k.s.trim());
    }
    const dir = limpiar(trozos.join(", "))
      .replace(/\s+-\s+-\s*/g, ", ")
      .replace(/[,;\s]*C\.?\s*P\.?\s*:?[,;\s]*$/i, "")
      .replace(/(\s*[,;]\s*)+/g, ", ")
      .replace(/^[,;\s-]+|[,;\s-]+$/g, "");
    if (dir.length >= 5) entrega = { nombre: nombreE && nombreE !== vendedor ? limpiar(nombreE) : null, direccion: dir.slice(0, 300) };
  }
  const telefono = (ci >= 0 ? lines.slice(ci).join("\n") : todo).match(/\bTEL\s*\.?\s*:[ \t]*([()\d][()\d \t-]{6,19})/i)?.[1]?.trim() ?? null;
  const moneda = (todo.match(/Moneda:\s*(MXN|USD)\b/i)?.[1]?.toUpperCase() as "MXN" | "USD" | undefined) ?? null;
  const metodo = (todo.match(/M[ée]todo de pago:\s*\(?(PUE|PPD)\)?/i)?.[1]?.toUpperCase() as "PUE" | "PPD" | undefined) ?? null;
  const condiciones = lines.map((l) => l.trim()).find((l) => /^(CR[EÉ]DITO\b.*|CONTADO\b.*)$/i.test(l) && l.length <= 40) ?? null;
  const dv = todo.match(/El d[ií]a\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  const vence = dv ? `${dv[3]}-${dv[2]}-${dv[1]}` : null;
  const montoDe = (re: RegExp) => {
    const m = lines.map((l) => l.trim().match(re)).find(Boolean);
    return m ? num(m[1]) : null;
  };
  const total = montoDe(/^Total\s+\$?\s*([\d,]+\.\d{2})$/i);
  const subtotal = montoDe(/^Subtotal\s+\$?\s*([\d,]+\.\d{2})$/i);
  const uuid = todo.match(/Folio fiscal:\s*([0-9A-F-]{36})/i)?.[1]?.toUpperCase() ?? null;
  const { pago, dias } = pagoDe(metodo, condiciones, fecha, vence);

  return {
    folio: folio ? folio.toUpperCase() : null, fecha, cliente, vendedor, lineas, avisos,
    uuid, rfc, razonSocial, nombreComercial: entrega ? null : nombreComercial, direccion, entrega, telefono, moneda, metodo, condiciones, pago, diasCredito: dias, vence, subtotal, total,
  };
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
  const fecha = attr(comp, "Fecha")?.slice(0, 10) ?? null;
  const metodo = (attr(comp, "MetodoPago")?.toUpperCase() as "PUE" | "PPD" | undefined) ?? null;
  const condiciones = dec(attr(comp, "CondicionesDePago")) || null;
  const { pago, dias } = pagoDe(metodo, condiciones, fecha, null);
  const tfd = xml.match(/<(?:\w+:)?TimbreFiscalDigital\b[^>]*>/)?.[0] ?? "";
  const n = (v: string | null) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const mon = attr(comp, "Moneda")?.toUpperCase();
  return {
    folio: folioN ? `${serie}${folioN}`.toUpperCase() : null,
    fecha,
    cliente: dec(attr(receptor, "Nombre")) || null,
    vendedor: null,
    lineas,
    avisos,
    uuid: attr(tfd, "UUID")?.toUpperCase() ?? null,
    rfc: attr(receptor, "Rfc")?.toUpperCase() ?? null,
    razonSocial: dec(attr(receptor, "Nombre")) || null,
    nombreComercial: null,
    direccion: attr(receptor, "DomicilioFiscalReceptor") ? `CP ${attr(receptor, "DomicilioFiscalReceptor")}` : null,
    telefono: null,
    moneda: mon === "MXN" || mon === "USD" ? mon : null,
    metodo: metodo === "PUE" || metodo === "PPD" ? metodo : null,
    condiciones,
    pago,
    diasCredito: dias,
    vence: null,
    subtotal: n(attr(comp, "SubTotal")),
    total: n(attr(comp, "Total")),
  };
}

/** Renglones de un PDF a partir de los elementos de texto de pdf.js (agrupados por altura, ordenados por x). */
export function filasDeItems(items: { str: string; transform: number[] }[]): Celda[][] {
  const rows = new Map<number, Celda[]>();
  for (const it of items) {
    if (!it.str?.trim()) continue;
    const y = Math.round(it.transform[5] / 2) * 2;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y)!.push({ x: it.transform[4], s: it.str.trim() });
  }
  return [...rows.keys()].sort((a, b) => b - a).map((y) => rows.get(y)!.sort((a, b) => a.x - b.x));
}
export function renglonesDeItems(items: { str: string; transform: number[] }[]): string[] {
  return filasDeItems(items).map((r) => r.map((c) => c.s).join("  "));
}
