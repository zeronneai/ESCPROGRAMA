import JSZip from "jszip";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { renglonesDocx, renglonesXlsx } from "@/lib/documento-texto";

describe("texto de Word y Excel", () => {
  it("docx: parrafos y renglones de tabla", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document><w:body>
      <w:p><w:r><w:t>PROFORMA INVOICE</w:t></w:r></w:p>
      <w:p><w:r><w:t>PI NO.: TH-1 &amp; co</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>TOTAL AMOUNT</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>USD 43,237.42</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`);
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    expect(await renglonesDocx(buf)).toEqual(["PROFORMA INVOICE", "PI NO.: TH-1 & co", "TOTAL AMOUNT USD 43,237.42"]);
  });
  it("xlsx: cada fila es un renglon", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("PI");
    ws.addRow(["PROFORMA INVOICE"]);
    ws.addRow(["PI NO.:", "TH-2"]);
    ws.addRow(["TOTAL", "USD", 100.5]);
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    expect(await renglonesXlsx(buf)).toEqual(["PROFORMA INVOICE", "PI NO.:  TH-2", "TOTAL  USD  100.5"]);
  });
});
