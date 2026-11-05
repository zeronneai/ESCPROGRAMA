import { describe, expect, it } from "vitest";
import { leerFacturaTexto, leerFacturaXml } from "@/lib/factura-lector";

// Renglones como salen del PDF de una factura de ESC (datos del cliente cambiados).
const PDF = [
  "Factura",
  "ESC REPRESENTACIONES S. DE R. L. MI.",
  "HEROICO COLEGIO MILITAR 5910-C  Folio",
  "F11318",
  "Serie y folio: F11318",
  "Fecha y hora de emisión: 2026-11-05T12:30:08",
  "Cliente  Vendedor",
  "CLIENTE DE PRUEBA SA  NOMBRE COMERCIAL",
  "DIANA PEREZ",
  "Clave SAT  U.med.  Nombre  Unidades  Precio  Descto.  Importe",
  "46181504  H87 - MASTER  Guante de Latex Libre de Polvo GG, talla L, caja con 10 cajitas de 100 pi  002-IVA  1920  10  1,200.00  12,000.00",
  "ESC-GLPFGG-L  ezas c/u",
  "46181504  H87 - MASTER  Guante de Latex Libre de Polvo GG, talla M, caja con 10 cajitas de 100  002-IVA  384  2  1,200.00  2,400.00",
  "ESC-GLPFGG-M  piezas c/u",
  "78102203  E48 - SERVICIO  Flete  002-IVA  16  1  100.00  100.00",
  "Cadena original del complemento de certificación digital del SAT:",
];

describe("lector de facturas", () => {
  it("PDF: folio, cliente, vendedor y partidas con clave ESC y cantidad", () => {
    const f = leerFacturaTexto(PDF);
    expect(f.folio).toBe("F11318");
    expect(f.fecha).toBe("2026-11-05");
    expect(f.cliente).toBe("CLIENTE DE PRUEBA SA · NOMBRE COMERCIAL");
    expect(f.vendedor).toBe("DIANA PEREZ");
    expect(f.lineas).toEqual([
      { clave: "ESC-GLPFGG-L", descripcion: "Guante de Latex Libre de Polvo GG, talla L, caja con 10 cajitas de 100 piezas c/u", unidad: "H87 - MASTER", cantidad: 10 },
      { clave: "ESC-GLPFGG-M", descripcion: "Guante de Latex Libre de Polvo GG, talla M, caja con 10 cajitas de 100 piezas c/u", unidad: "H87 - MASTER", cantidad: 2 },
      { clave: null, descripcion: "Flete", unidad: "E48 - SERVICIO", cantidad: 1 },
    ]);
    expect(f.avisos).toEqual([]);
  });

  it("PDF con descuento en la partida", () => {
    const f = leerFacturaTexto(["Serie y folio: A55", "46181504  H87 - CAJA  Guante  002-IVA  160  5  200.00  0.00  1,000.00", "ESC-X-1"]);
    expect(f.lineas[0]).toMatchObject({ clave: "ESC-X-1", cantidad: 5 });
    const g = leerFacturaTexto(["46181504  H87 - CAJA  Guante  002-IVA  144  5  200.00  100.00  900.00", "ESC-X-2"]);
    expect(g.lineas[0].cantidad).toBe(5);
    expect(g.avisos).toContain("No encontré el folio: escríbelo.");
  });

  it("XML del CFDI", () => {
    const xml = `<?xml version="1.0"?><cfdi:Comprobante Version="4.0" Serie="F" Folio="11318" Fecha="2026-11-05T12:30:08">
      <cfdi:Receptor Rfc="XAXX010101000" Nombre="CLIENTE &amp; HIJOS"/>
      <cfdi:Conceptos>
        <cfdi:Concepto ClaveProdServ="46181504" NoIdentificacion="ESC-GLPFGG-L" Cantidad="10.000000" ClaveUnidad="H87" Unidad="MASTER" Descripcion="Guante L"/>
        <cfdi:Concepto ClaveProdServ="78102203" Cantidad="1" ClaveUnidad="E48" Descripcion="Flete"/>
      </cfdi:Conceptos></cfdi:Comprobante>`;
    const f = leerFacturaXml(xml);
    expect(f).toMatchObject({ folio: "F11318", fecha: "2026-11-05", cliente: "CLIENTE & HIJOS" });
    expect(f.lineas).toEqual([
      { clave: "ESC-GLPFGG-L", descripcion: "Guante L", unidad: "MASTER", cantidad: 10 },
      { clave: null, descripcion: "Flete", unidad: "E48", cantidad: 1 },
    ]);
  });
});
