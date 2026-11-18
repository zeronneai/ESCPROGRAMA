import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { fechaIngles, OcDocument, type OcPdfModel } from "@/lib/pdf/oc-template";

describe("PDF de la Purchase Order", () => {
  it("fecha en ingles con sufijo", () => {
    expect(fechaIngles("2026-10-10")).toMatchObject({ mes: "October", dia: "10", sufijo: "th" });
    expect(fechaIngles("2026-11-01").sufijo).toBe("st");
    expect(fechaIngles("2026-11-22").sufijo).toBe("nd");
    expect(fechaIngles("2026-11-13").sufijo).toBe("th");
  });
  it("genera el PDF con el formato de ESC", async () => {
    const m: OcPdfModel = {
      folio: "26RIZ1024", fecha: "2026-10-10", proveedor: "RIZHAO ESHINE TRADING CO.,LTD", contacto: "Terry", enviarA: "Port of Export in China", firma: "Jose Luis Amaya",
      lineas: [
        { modelo: "TMIRF-YPQ", producto: "60 gsm PET Stitchbonded fabric, White colour. 1.10mt X 10mt bags, 14 needle, printed YAZ polybags on both sides. Good cross tensile strength. With label. 10 bags per case", cantidad: 200, precio: 15.4 },
        { modelo: "TMIRF-60", producto: "60 gsm PET Stitchbonded fabric, White colour. 1.10mt X 60mt rolls, cardboard core, 14 needle, printed YAZ polybags on both sides. Good cross tensile strength", cantidad: 1300, precio: 8.9 },
        { modelo: "TMIRF-Y", producto: "60 gsm PET Stitchbonded fabric, White colour. 1.10mt X 100mt rolls, cardboard core, 14 needle, printed YAZ polybags on both sides. Good cross tensile strength. With label", cantidad: 1800, precio: 14.5 },
        { modelo: "TMISD-1", producto: "16 gsm PP Nonwoven fabric, White colour. 1.10mt X 100mt rolls, cardboard core, printed ESTAM polybags on both sides.", cantidad: 2000, precio: 3.68 },
      ],
    };
    const logo = readFileSync(path.join(process.cwd(), "public", "logo-esc.png"));
    const pdf = await renderToBuffer(createElement(OcDocument, { m, logoSrc: logo }) as never);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    if (process.env.OC_PDF_OUT) writeFileSync(process.env.OC_PDF_OUT, pdf);
  });
});
