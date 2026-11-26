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
    expect(f.lineas.map(({ clave, descripcion, unidad, cantidad }) => ({ clave, descripcion, unidad, cantidad }))).toEqual([
      { clave: "ESC-GLPFGG-L", descripcion: "Guante de Latex Libre de Polvo GG, talla L, caja con 10 cajitas de 100 piezas c/u", unidad: "H87 - MASTER", cantidad: 10 },
      { clave: "ESC-GLPFGG-M", descripcion: "Guante de Latex Libre de Polvo GG, talla M, caja con 10 cajitas de 100 piezas c/u", unidad: "H87 - MASTER", cantidad: 2 },
      { clave: null, descripcion: "Flete", unidad: "E48 - SERVICIO", cantidad: 1 },
    ]);
    expect(f.avisos).toEqual([]);
  });

  it("membranas MSR-65 y MSR-65P (sin ESC- al principio); otras claves sin ESC- no", () => {
    const f = leerFacturaTexto([
      "Serie y folio: F11400",
      "30151505  H87 - PIEZA  Membrana de Super Refuerzo para Impermeabilizacion, blanca, 1.1 X 100,  002-IVA  2400  2  1,200.00  2,400.00",
      "MSR-65P  pieza",
      "30151505  H87 - PIEZA  Membrana de Super Refuerzo p/Impermeabilizacion, blanca, 100mts, con  002-IVA  1600  1  1,000.00  1,000.00",
      "MSR-65  Detalles",
      "30151505  H87 - PIEZA  Otra membrana  002-IVA  160  1  100.00  100.00",
      "MSR-650  extra",
    ]);
    expect(f.lineas.map((l) => [l.clave, l.cantidad])).toEqual([["MSR-65P", 2], ["MSR-65", 1], [null, 1]]);
    expect(f.lineas[0].descripcion).toMatch(/pieza$/);
  });

  it("PDF con descuento en la partida", () => {
    const f = leerFacturaTexto(["Serie y folio: A55", "46181504  H87 - CAJA  Guante  002-IVA  160  5  200.00  0.00  1,000.00", "ESC-X-1"]);
    expect(f.lineas[0]).toMatchObject({ clave: "ESC-X-1", cantidad: 5 });
    const g = leerFacturaTexto(["46181504  H87 - CAJA  Guante  002-IVA  144  5  200.00  100.00  900.00", "ESC-X-2"]);
    expect(g.lineas[0].cantidad).toBe(5);
    expect(g.avisos).toContain("No encontré el folio: escríbelo.");
  });

  it("PDF con descuento en porcentaje (factura F11286): lee cantidad, precio, descuento e importe", () => {
    const filas = [
      "Serie y folio: F11286",
      "Clave SAT  U.med.  Nombre  Impuesto Tasa Importe  Unidades  Precio  Descto.  Importe",
      "46182001  H87 - MASTER  Cubrebocas Plisado, Brondo, color Blanco, Master con 20 cajitas de 50  002-IVA  179.2  2  560.00  1,120.00",
      "ESC-DCBP3WH-20  pz",
      "Pedimento: 261633416002510/15-may.-2026/MANZANILLO",
      "46181708  H87 - MASTER  Red de Nylon para Cabello, Brondo, 21\", Negra, caja con 10 paquetes d  002-IVA  137.088  1  1,008.00  15.00 %  856.80",
      "ESC-DRNBK-2  e 100 piezas c/u",
      "Pedimento: 261633416003695/14-ago.-2026/MANZANILLO",
      "Subtotal  1,976.80",
      "Total  2,293.09",
    ];
    const f = leerFacturaTexto(filas);
    expect(f.avisos).toEqual([]);
    expect(f.lineas[0]).toMatchObject({ clave: "ESC-DCBP3WH-20", cantidad: 2, precio: 560, importe: 1120, descuentoPct: null });
    expect(f.lineas[1]).toMatchObject({ clave: "ESC-DRNBK-2", cantidad: 1, precio: 1008, importe: 856.8, descuentoPct: 15 });
    expect(f.total).toBe(2293.09);
    // El "%" puede venir en su propia columna.
    const g = leerFacturaTexto(["46181708  H87 - MASTER  Red  002-IVA  137.088  1  1,008.00  15.00  %  856.80", "ESC-DRNBK-2"]);
    expect(g.lineas[0]).toMatchObject({ cantidad: 1, descuentoPct: 15, importe: 856.8 });
    // Descuento como monto: se calcula el porcentaje.
    const h = leerFacturaTexto(["46181504  H87 - CAJA  Guante  002-IVA  144  5  200.00  100.00  900.00", "ESC-X-2"]);
    expect(h.lineas[0]).toMatchObject({ cantidad: 5, precio: 200, importe: 900, descuentoPct: 10 });
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
    expect(f.ordenCompra).toBeNull();
    // Pegatron: la orden de compra viene abajo de "Orden de compra"
    const P = G.map((r) => (r.some((c) => c.s === "RFC: SADE9212152G9") ? [...r, { x: 525, s: "0900512429" }] : r));
    expect(leerFacturaTexto(P.map((r) => r.map((c) => c.s).join("  ")), P).ordenCompra).toBe("0900512429");
    // Como la FD2595: la etiqueta partida en dos y el numero dos renglones abajo, un poco corrido
    const Q: Celda[][] = G.map((r) => r.map((c) => (c.s === "Orden de compra" ? [{ x: 530, s: "Orden de" }, { x: 575, s: "compra" }] : [c])).flat());
    const qi = Q.findIndex((r) => r.some((c) => c.s === "TEL : 614 551 9914"));
    Q.splice(qi + 1, 0, [{ x: 560, s: "0900512913" }]);
    expect(leerFacturaTexto(Q.map((r) => r.map((c) => c.s).join("  ")), Q).ordenCompra).toBe("0900512913");
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
    const f = leerFacturaXml(`<cfdi:Comprobante Version="4.0" Serie="F" Folio="1" Fecha="2026-11-05T10:00:00" SubTotal="100" Total="116" Moneda="USD" TipoCambio="17.8523" MetodoPago="PPD" CondicionesDePago="CREDITO 30 DIAS">
      <cfdi:Receptor Rfc="PELJ800101AB1" Nombre="JUAN PEREZ" DomicilioFiscalReceptor="31000"/>
      <cfdi:Conceptos><cfdi:Concepto NoIdentificacion="ESC-X-1" Cantidad="1" Descripcion="X"/></cfdi:Conceptos>
      <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb"/></cfdi:Complemento></cfdi:Comprobante>`);
    expect(f).toMatchObject({ rfc: "PELJ800101AB1", razonSocial: "JUAN PEREZ", total: 116, subtotal: 100, moneda: "USD", tipoCambio: 17.8523, pago: "credito", diasCredito: 30, uuid: "AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB", direccion: "CP 31000" });
  });
});

describe("tipo de cambio impreso en la factura", () => {
  it("lo encuentra en las formas comunes y descarta valores raros", async () => {
    const { tipoCambioDeTexto } = await import("@/lib/factura-lector");
    expect(tipoCambioDeTexto("Moneda: USD   Tipo de cambio: 18.2345   Forma de pago")).toBe(18.2345);
    expect(tipoCambioDeTexto("Moneda: USD T.C. $17.95")).toBe(17.95);
    expect(tipoCambioDeTexto("TIPO DE CAMBIO 19,1023")).toBe(19.1023);
    expect(tipoCambioDeTexto("Tipo de cambio: 1.0000")).toBeNull();
    expect(tipoCambioDeTexto("Moneda: MXN Forma de pago")).toBeNull();
  });
});

describe("ventas en pesos y dolares por separado", () => {
  it("no mezcla monedas", async () => {
    const { montoPorMoneda, fmtMonedas } = await import("@/lib/ventas");
    const t = montoPorMoneda([{ monto: 1000, moneda: "MXN" }, { monto: 100, moneda: "USD" }, { monto: 50, moneda: "USD" }]);
    expect(t).toEqual({ mxn: 1000, usd: 150 });
    expect(fmtMonedas(t)).toBe("$1,000 · $150 USD");
    expect(fmtMonedas({ mxn: 0, usd: 20 })).toBe("$20 USD");
    expect(fmtMonedas({ mxn: 5, usd: 0 })).toBe("$5");
  });
});

describe("volver a leer el importe de facturas ya subidas", () => {
  it("empareja por orden, por clave o por descripcion", async () => {
    const { emparejarImportes } = await import("@/lib/comisiones");
    const g = [
      { id: "a", clave: "ESC-1", descripcion: "Guante nitrilo", cantidad: 10 },
      { id: "b", clave: null, descripcion: "Flete", cantidad: 1 },
    ];
    expect([...emparejarImportes(g, [{ clave: "ESC-1", descripcion: "Guante nitrilo talla M", cantidad: 10, importe: 500 }, { clave: null, descripcion: "Flete", cantidad: 1, importe: 150 }])]).toEqual([["a", 500], ["b", 150]]);
    // En otro orden y con un renglon de mas
    expect([...emparejarImportes(g, [{ clave: null, descripcion: "FLETE", cantidad: 1, importe: 150 }, { clave: "ESC-9", descripcion: "Bata", cantidad: 2, importe: 80 }, { clave: "esc-1", descripcion: "x", cantidad: 10, importe: 500 }])].sort()).toEqual([["a", 500], ["b", 150]]);
    // Cantidad distinta: no se adivina
    expect(emparejarImportes([{ id: "a", clave: "ESC-1", descripcion: "Guante", cantidad: 10 }], [{ clave: "ESC-1", descripcion: "Guante", cantidad: 3, importe: 9 }]).size).toBe(0);
  });
});

describe("envio incluido en la comision", () => {
  it("reparte el envio segun el importe y lo resta", async () => {
    const { repartirEnvio, comisionDe } = await import("@/components/ventas/comision-editor");
    expect(repartirEnvio([300, 700], 100)).toEqual([30, 70]);
    expect(repartirEnvio([1, 1, 1], 100).reduce((a, x) => a + x, 0)).toBeCloseTo(100, 2);
    expect(repartirEnvio([0, 0], 50)).toEqual([0, 0]);
    expect(comisionDe({ id: "a", clave: null, descripcion: "x", cantidad: 1, imp: "1000", env: "200", pct: "5" })).toBe(40);
    expect(comisionDe({ id: "a", clave: null, descripcion: "x", cantidad: 1, imp: "1000", env: "", pct: "5" })).toBe(50);
  });
});

describe("estado de cuenta (conciliacion)", () => {
  const fila = (...c: [number, string][]) => c.map(([x, s]) => ({ x, s }));
  it("BBVA: solo abonos, fecha sin año, descripcion arriba y abajo, cuenta en dolares", async () => {
    const { leerEstadoCuenta } = await import("@/lib/estado-cuenta");
    const r = leerEstadoCuenta([[
      fila([24, "24/11/26, 8:07"], [276, "BBVANet - Cuenta de cheques y ahorro"]),
      fila([78, "24/11/2026 - 8:07:58 AM"]),
      fila([225, "Número de cuenta:"], [318, "0123456157"]),
      fila([78, "Fecha"], [161, "Concepto / Referencia"], [329, "Cargo"], [397, "Abono"], [478, "Saldo"]),
      fila([131, "SPEI RECIBIDOBAJIO/0112019763 030"]),
      fila([80, "24-11"], [388, "$ 13,363.20"], [465, "$ 724,490.45"]),
      fila([166, "0241126ESC Factura F11466"]),
      fila([130, "IVA TASA DE DESC DEBITO/174598428"]),
      fila([80, "24-11"], [330, "$ 8.29"], [466, "$ 711,127.25"]),
      fila([142, "TERMINALES PUNTO DE VENTA"]),
      fila([80, "23-12"], [122, "DEPOSITO EN EFECTIVO/0053642"], [390, "$ 9,483.00"], [465, "$ 711,135.54"]),
    ]]);
    expect(r).toMatchObject({ banco: "BBVA", cuenta: "0123456157", moneda: "USD", cargosIgnorados: 1, cuadran: 2, noCuadran: 0 });
    expect(r.abonos).toEqual([
      { fecha: "2026-11-24", descripcion: "SPEI RECIBIDOBAJIO/0112019763 030 0241126ESC Factura F11466", referencia: null, monto: 13363.2, saldo: 724490.45 },
      { fecha: "2025-12-23", descripcion: "DEPOSITO EN EFECTIVO/0053642", referencia: null, monto: 9483, saldo: 711135.54 },
    ]);
  });
  it("Banregio: descripcion de varios renglones debajo y referencia", async () => {
    const { leerEstadoCuenta } = await import("@/lib/estado-cuenta");
    const r = leerEstadoCuenta([[
      fila([340, "Detalle de Movimientos Cuenta de Cheques"]),
      fila([240, "CUENTA: 061022470018"]),
      fila([228, "CLABE: 058150610224700180"]),
      fila([25, "Fecha"], [82, "Descripción"], [249, "Referencia"], [421, "Cargos"], [485, "Abonos"], [548, "Saldo"]),
      fila([82, "AMSIU93 SPEI, HSBC, 021060040273206542,"]),
      fila([22, "09/11/2026"], [249, "_HSB6046610"], [475, "$ 41,993.95"], [531, "$ 156,476.05"]),
      fila([82, "AISLANTES TERMOACUSTICOS DEL NORTE , S.,"]),
      fila([82, "HSB6046610, 0000001, FAC 2395"]),
      fila([22, "13/11/2026"], [82, "NÓMINA - PAGO DE NÓMINA"], [249, "_061022470018"], [414, "$ 6,794.20"], [531, "$ 149,681.85"]),
      fila([251, "Total Cargos: $6794.20"]),
    ]]);
    expect(r).toMatchObject({ banco: "Banregio", cuenta: "061022470018", moneda: "MXN", cargosIgnorados: 1, totalAbonos: 41993.95, noCuadran: 0 });
    expect(r.abonos[0]).toMatchObject({ fecha: "2026-11-09", referencia: "HSB6046610", descripcion: "AMSIU93 SPEI, HSBC, 021060040273206542, AISLANTES TERMOACUSTICOS DEL NORTE , S., HSB6046610, 0000001, FAC 2395" });
  });
  it("sugiere folios de la descripcion", async () => {
    const { foliosSugeridos } = await import("@/lib/conciliaciones");
    expect(foliosSugeridos("PAGO CUENTA DE TERCERO BNET 0123160645 F11488")).toEqual(["F11488"]);
    expect(foliosSugeridos("0231126Pago Factura PMC146 ESC")).toEqual(["PMC146"]);
    expect(foliosSugeridos("BNET 1585530792 pago fact 10872 ES")).toEqual(["10872"]);
  });
});

describe("plazo para identificar pagos", () => {
  it("cuenta 7 dias desde que se sube", async () => {
    const { diasRestantes } = await import("@/lib/conciliaciones");
    const ahora = new Date("2026-11-24T12:00:00Z").getTime();
    expect(diasRestantes("2026-11-24T10:00:00Z", ahora)).toBe(7);
    expect(diasRestantes("2026-11-20T12:00:00Z", ahora)).toBe(3);
    expect(diasRestantes("2026-11-16T12:00:00Z", ahora)).toBeLessThanOrEqual(0);
  });
});
