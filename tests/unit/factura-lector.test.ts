import { describe, expect, it } from "vitest";
import { leerFacturaTexto, leerFacturaXml, pagoDe, type Celda } from "@/lib/factura-lector";

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

describe("datos de cliente y cobranza", () => {
  // Renglones con su columna (x) como los arma pdf.js. Datos del cliente inventados.
  const F: Celda[][] = [
    [{ x: 40, s: "Serie y folio: F900" }],
    [{ x: 40, s: "Fecha y hora de emisión: 2026-11-05T12:30:08" }],
    [{ x: 40, s: "Folio fiscal: 5e5b7331-1608-624b-9577-56f2133ad967" }],
    [{ x: 40, s: "Moneda: MXN" }, { x: 300, s: "Forma de pago: (99) Por definir" }],
    [{ x: 40, s: "Método de Pago: (PPD) Pago en parcialidades o diferido" }],
    [{ x: 50, s: "Cliente" }, { x: 520, s: "Vendedor" }],
    [{ x: 45, s: "JUAN PEREZ LOPEZ" }, { x: 260, s: "TACOS EL GUERO" }],
    [{ x: 520, s: "DIANA PEREZ" }],
    [{ x: 260, s: "AV. ENTREGA 10" }],
    [{ x: 45, s: "CALLE FISCAL 123" }],
    [{ x: 520, s: "Condiciones" }],
    [{ x: 45, s: "COL. CENTRO" }],
    [{ x: 520, s: "CREDITO 15 DIAS" }],
    [{ x: 45, s: "CHIHUAHUA, CHIH CP: 31000" }],
    [{ x: 45, s: "RFC: PELJ800101AB1" }],
    [{ x: 45, s: "TEL :" }, { x: 80, s: "(614) 123-4567" }],
    [{ x: 40, s: "46181504" }, { x: 80, s: "H87 - CAJA" }, { x: 120, s: "Guante" }, { x: 300, s: "002-IVA" }, { x: 340, s: "160" }, { x: 380, s: "5" }, { x: 420, s: "200.00" }, { x: 480, s: "1,000.00" }],
    [{ x: 40, s: "ESC-X-1" }],
    [{ x: 400, s: "Subtotal" }, { x: 500, s: "1,000.00" }],
    [{ x: 400, s: "Total" }, { x: 500, s: "1,160.00" }],
    [{ x: 40, s: "Debo y Pagaré ... El día 20/11/2026 la" }],
  ];
  it("PDF: RFC, nombres, direccion fiscal, telefono, credito y total", () => {
    const f = leerFacturaTexto(F.map((r) => r.map((c) => c.s).join("  ")), F);
    expect(f).toMatchObject({
      folio: "F900", uuid: "5E5B7331-1608-624B-9577-56F2133AD967", rfc: "PELJ800101AB1",
      razonSocial: "JUAN PEREZ LOPEZ", nombreComercial: null, entrega: { nombre: "TACOS EL GUERO", direccion: "AV. ENTREGA 10" },
      direccion: "CALLE FISCAL 123, COL. CENTRO, CHIHUAHUA, CHIH CP: 31000", telefono: "(614) 123-4567",
      moneda: "MXN", metodo: "PPD", condiciones: "CREDITO 15 DIAS", pago: "credito", diasCredito: 15, vence: "2026-11-20",
      subtotal: 1000, total: 1160,
    });
  });
  it("PDF: domicilio de entrega como en la factura F11341 (columna de en medio)", () => {
    const G: Celda[][] = [
      [{ x: 40, s: "Serie y folio: F11341" }],
      [{ x: 50, s: "Cliente" }, { x: 520, s: "Vendedor" }],
      [{ x: 40, s: "JOSE EDUARDO SALDAÑA DURAN" }, { x: 300, s: "Encapsuladoras México" }, { x: 520, s: "DIANA PEREZ" }],
      [{ x: 300, s: "C.Apicultura, No. 12403 -  - Col. Zootecnia" }],
      [{ x: 40, s: "MARIANO GUILLEN No. 9021" }, { x: 520, s: "Condiciones" }],
      [{ x: 40, s: "COL. LOS PINOS" }, { x: 520, s: "CONTADO" }],
      [{ x: 40, s: "CHIHUAHUA, CHIH. CP: 31416" }, { x: 520, s: "Orden de compra" }],
      [{ x: 40, s: "RFC: SADE9212152G9" }, { x: 300, s: ", ; C.P. :" }],
      [{ x: 40, s: "TEL : 614 551 9914" }],
      [{ x: 40, s: "Régimen fiscal: 612/Personas Físicas con Actividades Empresariales y Profesionales" }],
      [{ x: 40, s: "46181504" }, { x: 80, s: "H87 - MASTER" }, { x: 120, s: "Guante" }, { x: 300, s: "002-IVA" }, { x: 340, s: "160" }, { x: 380, s: "1" }, { x: 420, s: "1,000.00" }, { x: 480, s: "1,000.00" }],
      [{ x: 40, s: "ESC-GNPFGGBK-S" }],
    ];
    const f = leerFacturaTexto(G.map((r) => r.map((c) => c.s).join("  ")), G);
    expect(f).toMatchObject({
      razonSocial: "JOSE EDUARDO SALDAÑA DURAN", nombreComercial: null, rfc: "SADE9212152G9", vendedor: "DIANA PEREZ",
      direccion: "MARIANO GUILLEN No. 9021, COL. LOS PINOS, CHIHUAHUA, CHIH. CP: 31416",
      entrega: { nombre: "Encapsuladoras México", direccion: "C.Apicultura, No. 12403, Col. Zootecnia" },
    });
    // Sin domicilio en la columna de en medio: el nombre sigue siendo el nombre comercial.
    const H = G.filter((r) => !r.some((c) => c.x === 300 && c.s !== "Encapsuladoras México"));
    const h = leerFacturaTexto(H.map((r) => r.map((c) => c.s).join("  ")), H);
    expect(h).toMatchObject({ nombreComercial: "Encapsuladoras México", entrega: null });
  });
  it("contado o credito", () => {
    expect(pagoDe("PUE", null, null, null)).toEqual({ pago: "contado", dias: null });
    expect(pagoDe("PPD", null, "2026-11-01", "2026-12-01")).toEqual({ pago: "credito", dias: 30 });
    expect(pagoDe("PUE", "CONTADO", null, null)).toEqual({ pago: "contado", dias: null });
    expect(pagoDe(null, "Credito 30 dias", null, null)).toEqual({ pago: "credito", dias: 30 });
  });
  it("XML: receptor, total, metodo y UUID", () => {
    const f = leerFacturaXml(`<cfdi:Comprobante Version="4.0" Serie="F" Folio="1" Fecha="2026-11-05T10:00:00" SubTotal="100" Total="116" Moneda="USD" MetodoPago="PPD" CondicionesDePago="CREDITO 30 DIAS">
      <cfdi:Receptor Rfc="PELJ800101AB1" Nombre="JUAN PEREZ" DomicilioFiscalReceptor="31000"/>
      <cfdi:Conceptos><cfdi:Concepto NoIdentificacion="ESC-X-1" Cantidad="1" Descripcion="X"/></cfdi:Conceptos>
      <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb"/></cfdi:Complemento></cfdi:Comprobante>`);
    expect(f).toMatchObject({ rfc: "PELJ800101AB1", razonSocial: "JUAN PEREZ", total: 116, subtotal: 100, moneda: "USD", pago: "credito", diasCredito: 30, uuid: "AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB", direccion: "CP 31000" });
  });
});
