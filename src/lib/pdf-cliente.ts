/**
 * Datos de un cliente a partir de un PDF: una factura de ESC (bloque "Cliente") o la Constancia de
 * Situacion Fiscal del SAT. Se lee en el navegador; el vendedor revisa antes de guardar.
 */
import { filasDeItems, leerFacturaTexto, type FacturaLeida } from "@/lib/factura-lector";
import { partirDireccion } from "@/lib/ops/guias";

export type DatosClientePdf = {
  razon_social: string;
  nombre: string;
  rfc: string;
  direccion: string;
  estado_geo: string;
  contacto_telefono: string;
  fuente: "factura" | "constancia";
};

const RFC_RE = /\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/;

/** Renglones (y celdas) de todas las paginas del PDF. */
export async function renglonesPdf(f: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
  const filas: ReturnType<typeof filasDeItems> = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    filas.push(...filasDeItems(tc.items as { str: string; transform: number[] }[]));
  }
  return { filas, lineas: filas.map((r) => r.map((c) => c.s).join("  ")) };
}

/** Factura de ESC leida desde el PDF. */
export async function leerFacturaPdf(f: File): Promise<FacturaLeida> {
  const { filas, lineas } = await renglonesPdf(f);
  return leerFacturaTexto(lineas, filas);
}

/** Constancia de Situacion Fiscal: "Etiqueta: valor" en renglones. */
export function leerConstancia(lineas: string[]): DatosClientePdf | null {
  const todo = lineas.join("\n");
  if (!/CONSTANCIA DE SITUACI[OÓ]N FISCAL|C[eé]dula de identificaci[oó]n fiscal/i.test(todo)) return null;
  const campo = (re: RegExp) => {
    for (const l of lineas) {
      const m = l.match(re);
      const v = m?.[1]?.replace(/\s{2,}.*$/, "").trim();
      // Campo vacio: lo que sigue es la siguiente etiqueta ("Nombre de la Colonia: ...").
      if (v && !/^[^:]{2,45}:/.test(v)) return v;
    }
    return "";
  };
  const rfc = campo(/RFC:\s*([A-ZÑ&0-9]{12,13})/i) || (todo.match(RFC_RE)?.[1] ?? "");
  const razon = campo(/(?:Denominaci[oó]n\s*\/\s*Raz[oó]n Social|Raz[oó]n Social):\s*(.+)/i)
    || [campo(/Nombre\s*\(s\):\s*(.+)/i), campo(/Primer Apellido:\s*(.+)/i), campo(/Segundo Apellido:\s*(.+)/i)].filter(Boolean).join(" ");
  const via = [campo(/Tipo de Vialidad:\s*(.+)/i), campo(/Nombre de Vialidad:\s*(.+)/i)].filter(Boolean).join(" ");
  const num = campo(/N[uú]mero Exterior:\s*(.+)/i);
  const int = campo(/N[uú]mero Interior:\s*(.+)/i);
  const col = campo(/Nombre de la Colonia:\s*(.+)/i);
  const cp = campo(/C[oó]digo Postal:\s*(\d{5})/i);
  const mun = campo(/Nombre del Municipio o Demarcaci[oó]n Territorial:\s*(.+)/i) || campo(/Nombre de la Localidad:\s*(.+)/i);
  const ent = campo(/Nombre de la Entidad Federativa:\s*(.+)/i);
  const direccion = [`${via}${num ? ` ${num}` : ""}${int ? ` INT ${int}` : ""}`.trim(), col && `COL. ${col}`, mun && ent ? `${mun}, ${ent}` : mun || ent, cp && `CP ${cp}`]
    .filter(Boolean).join(", ");
  if (!rfc && !razon) return null;
  return { razon_social: razon, nombre: campo(/Nombre Comercial:\s*(.+)/i) || razon, rfc, direccion, estado_geo: estadoDe(ent || direccion), contacto_telefono: "", fuente: "constancia" };
}

function estadoDe(texto: string) {
  return partirDireccion(`x, ${texto}`).estado_geo;
}

/** Lee el PDF (factura de ESC o constancia del SAT) y regresa los datos del cliente que encontro. */
export async function datosClienteDePdf(f: File): Promise<DatosClientePdf | null> {
  const { filas, lineas } = await renglonesPdf(f);
  const c = leerConstancia(lineas);
  if (c) return c;
  const fa = leerFacturaTexto(lineas, filas);
  if (!fa.rfc && !fa.razonSocial) return null;
  return {
    razon_social: fa.razonSocial ?? "",
    nombre: fa.nombreComercial ?? fa.razonSocial ?? "",
    rfc: fa.rfc ?? "",
    direccion: fa.direccion ?? "",
    estado_geo: estadoDe(fa.direccion ?? ""),
    contacto_telefono: fa.telefono ?? "",
    fuente: "factura",
  };
}
