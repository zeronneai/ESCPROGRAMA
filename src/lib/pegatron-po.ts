/**
 * Lector de la orden de compra (P/O) de Pegatron en PDF.
 * La tabla viene por columnas: ITEM, PART NUMBER, DESCRIPTION (en varios renglones), MARKING CODE,
 * UNIT PRICE, QTY, UNIT, SUB TOTAL, ..., DELIVERY DATE. Se usa la posicion (x, y) de cada texto.
 */

export type TextoPdf = { x: number; y: number; s: string; pagina: number };

export type LineaPegatron = {
  item: string;
  numero_parte: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  entrega: string | null;
};

export type OcPegatron = {
  po_numero: string;
  fecha: string | null;
  moneda: "USD" | "MXN" | null;
  lineas: LineaPegatron[];
};

const num = (s: string) => Number(s.replace(/,/g, ""));

/** "11/30/2026" (MM/DD/YYYY) -> "2026-11-30". */
function fechaUS(s: string): string | null {
  const m = s.replace(/\s+/g, "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [mm, dd, yy] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Valor que sigue a una etiqueta en el mismo renglon ("P/O NUMBER:" -> "0920711410"). */
function despuesDe(textos: TextoPdf[], re: RegExp): string | null {
  const et = textos.find((t) => re.test(t.s));
  if (!et) return null;
  const mismo = et.s.replace(re, "").trim();
  if (mismo) return mismo;
  const sig = textos
    .filter((t) => t.pagina === et.pagina && Math.abs(t.y - et.y) < 3 && t.x > et.x)
    .sort((a, b) => a.x - b.x)[0];
  return sig?.s.trim() ?? null;
}

export function leerOcPegatron(textos: TextoPdf[]): OcPegatron {
  const po = despuesDe(textos, /^P\/O NUMBER:?/i)?.replace(/\s/g, "") ?? "";
  const fecha = fechaUS(despuesDe(textos, /^PURCHASE DATE:?/i) ?? "");
  const mon = (despuesDe(textos, /^CURRENCY:?/i) ?? "").toUpperCase();
  const lineas: LineaPegatron[] = [];

  const paginas = [...new Set(textos.map((t) => t.pagina))].sort((a, b) => a - b);
  for (const p of paginas) {
    const T = textos.filter((t) => t.pagina === p);
    const hdr = (re: RegExp) => T.find((t) => re.test(t.s.trim()));
    const hItem = hdr(/^ITEM$/i);
    const hDesc = hdr(/^DESCRIPTI/i);
    const hMark = hdr(/^MARKING$/i);
    const hQty = T.filter((t) => /^QTY$/i.test(t.s.trim())).sort((a, b) => a.x - b.x)[0];
    if (!hItem || !hDesc || !hQty) continue;
    const hPart = hdr(/^PART$/i);
    const hPrice = T.find((t) => /^PRICE$/i.test(t.s.trim()));
    const hUnit = T.filter((t) => /^UNIT$/i.test(t.s.trim()) && t.x > hQty.x).sort((a, b) => a.x - b.x)[0];
    const hSub = hdr(/^SUB$/i);
    const hDate = hdr(/^DELIVERY$/i);
    const yTabla = Math.min(...T.filter((t) => /^(ITEM|DESCRIPTI|QTY|HSN\/SAC|DATE)$/i.test(t.s.trim())).map((t) => t.y));
    const fin = T.find((t) => /^(稅額|合計|TAX|TOTAL AMOUNT)/i.test(t.s.trim()) && t.y < yTabla);
    // El renglon de impuestos ("稅額： 937.22") puede quedar un poco arriba de su etiqueta.
    const yFin = fin ? fin.y + 4 : -Infinity;

    // Limites de columnas (a la mitad entre encabezados).
    const xDescIni = hPart ? (hPart.x + hDesc.x) / 2 + 8 : hDesc.x - 6;
    const xDescFin = hMark ? hMark.x - 4 : hDesc.x + 40;
    const xPartIni = hItem.x + 15;
    const xQtyIni = hPrice ? hPrice.x + 20 : hQty.x - 25;
    const xQtyFin = hUnit ? (hQty.x + hUnit.x) / 2 + 5 : hQty.x + 25;
    const xUnitFin = hSub ? hSub.x - 8 : (hUnit?.x ?? hQty.x) + 30;

    // Renglones: un numero de ITEM en la primera columna.
    const items = T.filter((t) => t.y < yTabla - 2 && t.y > yFin && t.x < xPartIni && /^\d{1,5}$/.test(t.s.trim())).sort((a, b) => b.y - a.y);
    items.forEach((it, k) => {
      const yIni = it.y + 3;
      const ySig = k + 1 < items.length ? items[k + 1].y + 3 : yFin;
      const banda = T.filter((t) => t.y <= yIni && t.y > ySig).sort((a, b) => b.y - a.y || a.x - b.x);
      const enCol = (a: number, b: number) => banda.filter((t) => t.x >= a && t.x < b);
      const descripcion = enCol(xDescIni, xDescFin).map((t) => t.s.trim()).join(" ").replace(/\s+/g, " ").trim();
      const parte = enCol(xPartIni, xDescIni).map((t) => t.s.trim()).join("").replace(/\s+/g, "");
      const qtyTxt = enCol(xQtyIni, xQtyFin).find((t) => /^[\d,]+(\.\d+)?$/.test(t.s.trim()))?.s.trim();
      const unidad = hUnit ? enCol(xQtyFin, xUnitFin).map((t) => t.s.trim()).join(" ") : "";
      const fechaTxt = hDate ? enCol(hDate.x - 6, hDate.x + 30).map((t) => t.s.trim()).join("") : "";
      const cantidad = qtyTxt ? num(qtyTxt) : NaN;
      if (!descripcion || !(cantidad > 0)) return;
      lineas.push({ item: it.s.trim(), numero_parte: parte, descripcion: descripcion.slice(0, 500), cantidad, unidad: unidad.slice(0, 20), entrega: fechaUS(fechaTxt) });
    });
  }
  return { po_numero: po, fecha, moneda: mon === "USD" || mon === "MXN" ? mon : null, lineas };
}

/** Textos con su posicion, de todas las paginas del PDF (en el navegador). */
export async function textosPdf(f: File): Promise<TextoPdf[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
  const out: TextoPdf[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    for (const it of tc.items as { str: string; transform: number[] }[]) {
      if (it.str?.trim()) out.push({ x: it.transform[4], y: it.transform[5], s: it.str, pagina: i });
    }
  }
  return out;
}
