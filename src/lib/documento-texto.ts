/** Texto (renglones) de un Excel .xlsx o un Word .docx. Solo para el servidor. */
import JSZip from "jszip";

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

export async function renglonesDocx(buf: ArrayBuffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const texto = (frag: string) =>
    decode(frag.replace(/<w:tab\/>|<w:br\/>|<\/w:p>/g, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  // Cada renglon de tabla se vuelve un solo renglon (celdas separadas); fuera de tablas, cada parrafo.
  const plano = xml.replace(/<w:tr[\s>][\s\S]*?<\/w:tr>/g, (tr) => {
    const celdas = (tr.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) ?? []).map(texto).filter(Boolean);
    return `<w:p>${celdas.join("  ").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:p>`;
  });
  const out = plano.split(/<\/w:p>/).map(texto).filter(Boolean);
  return out;
}

export async function renglonesXlsx(buf: ArrayBuffer): Promise<string[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buf) as never);
  const out: string[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals: string[] = [];
      r.eachCell({ includeEmpty: false }, (c) => {
        const t = (c.text ?? "").toString().replace(/\s+/g, " ").trim();
        if (t) vals.push(t);
      });
      if (vals.length) out.push(vals.join("  "));
    });
  }
  return out;
}
