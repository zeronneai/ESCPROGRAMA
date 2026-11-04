/** Importar proveedores desde Excel o CSV: lectura, columnas sugeridas y limpieza de cada fila. */

export const CAMPOS_IMPORT = [
  { k: "nombre", label: "Nombre *" },
  { k: "razon_social", label: "Razón social" },
  { k: "rfc", label: "RFC / Tax ID" },
  { k: "contacto_nombre", label: "Contacto" },
  { k: "telefono", label: "Teléfono" },
  { k: "correo", label: "Correo" },
  { k: "pais", label: "País" },
  { k: "giro", label: "Qué surte" },
  { k: "direccion", label: "Dirección" },
  { k: "sitio_web", label: "Sitio web" },
  { k: "condiciones_pago", label: "Condiciones de pago" },
  { k: "notas", label: "Notas" },
] as const;
export type CampoImport = (typeof CAMPOS_IMPORT)[number]["k"];
export type Mapeo = Partial<Record<CampoImport, number>>;

const SINONIMOS: [CampoImport, string[]][] = [
  ["contacto_nombre", ["contacto", "contact", "persona de contacto", "attn", "atencion", "ejecutivo", "sales rep"]],
  ["razon_social", ["razon social", "legal name", "denominacion"]],
  ["correo", ["correo", "email", "e-mail", "mail"]],
  ["telefono", ["telefono", "tel", "phone", "celular", "whatsapp", "movil", "cel"]],
  ["rfc", ["rfc", "tax id", "taxid", "vat", "nit"]],
  ["pais", ["pais", "country"]],
  ["giro", ["giro", "que surte", "producto", "productos", "categoria", "category", "products", "linea"]],
  ["direccion", ["direccion", "address", "domicilio", "ubicacion"]],
  ["sitio_web", ["sitio web", "website", "web", "url", "pagina"]],
  ["condiciones_pago", ["condiciones", "terminos", "payment", "terms", "credito", "forma de pago"]],
  ["notas", ["notas", "notes", "comentarios", "observaciones"]],
  ["nombre", ["nombre", "proveedor", "supplier", "vendor", "company", "empresa", "name", "nombre comercial"]],
];

export const normTxt = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Adivina que columna corresponde a cada campo por el encabezado. */
export function adivinarColumnas(headers: string[]): Mapeo {
  const h = headers.map(normTxt);
  const out: Mapeo = {};
  const usada = new Set<number>();
  // Primero coincidencias exactas, luego encabezados que contienen la palabra.
  for (const pass of ["exacta", "contiene"] as const) {
    for (const [campo, syn] of SINONIMOS) {
      if (out[campo] !== undefined) continue;
      const i = h.findIndex((x, j) => !usada.has(j) && syn.some((s) => (pass === "exacta" ? x === s : x.includes(s))));
      if (i >= 0) {
        out[campo] = i;
        usada.add(i);
      }
    }
  }
  if (out.nombre === undefined && headers.length && !usada.has(0)) out.nombre = 0;
  return out;
}

/** CSV con comas, punto y coma o tabuladores, y textos entre comillas. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
}

export interface ProveedorImport {
  nombre: string;
  razon_social: string | null;
  rfc: string | null;
  contacto_nombre: string | null;
  telefono: string | null;
  correo: string | null;
  pais: string | null;
  giro: string | null;
  direccion: string | null;
  sitio_web: string | null;
  condiciones_pago: string | null;
  notas: string | null;
  tipo: "nacional" | "extranjero";
}

const LIM: Record<CampoImport, number> = {
  nombre: 200, razon_social: 200, rfc: 20, contacto_nombre: 150, telefono: 40, correo: 150, pais: 60, giro: 200,
  direccion: 300, sitio_web: 200, condiciones_pago: 150, notas: 1000,
};

/** Convierte una fila con el mapeo elegido; los datos raros se dejan vacios en vez de fallar. */
export function filaAProveedor(row: string[], m: Mapeo): ProveedorImport | null {
  const get = (k: CampoImport) => {
    const i = m[k];
    const v = i === undefined ? "" : String(row[i] ?? "").trim();
    return v ? v.slice(0, LIM[k]) : null;
  };
  const nombre = get("nombre");
  if (!nombre || nombre.length < 2) return null;
  let correo = get("correo");
  if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) correo = null;
  const pais = get("pais");
  const mx = !pais || ["mexico", "mx", "mex"].includes(normTxt(pais));
  return {
    nombre, razon_social: get("razon_social"), rfc: get("rfc")?.toUpperCase() ?? null, contacto_nombre: get("contacto_nombre"),
    telefono: get("telefono"), correo: correo?.toLowerCase() ?? null, pais, giro: get("giro"), direccion: get("direccion"),
    sitio_web: get("sitio_web"), condiciones_pago: get("condiciones_pago"), notas: get("notas"), tipo: mx ? "nacional" : "extranjero",
  };
}
