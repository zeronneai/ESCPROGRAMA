import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { buildPdfModel, COLUMN_HEADERS, computeOrder, pdfFileName, pdfProblems, PdfNotReadyError, type PdfInput, type PdfItemInput } from "@/lib/pdf/model";
import { NO_SHIPPING, type ShippingPlan } from "@/lib/pricing/shipping-allocation";
import { QuoteDocument } from "@/lib/pdf/quote-template";

const company = {
  nombre_comercial: "ESC Representaciones", razon_social: "ESC REPRESENTACIONES S. DE R. L. MI.", telefono: "(614) 424-6200",
  web: "www.elsauz.com", direccion: "H. COLEGIO MILITAR No.5910-C, COL. NOMBRE DE DIOS C.P.31105, CHIHUAHUA, MEXICO",
  rfc: "RFC ERE 060228 NLA", pie_lineas: ["16% VAT will be added to the invoice", "Prices subject to change"],
};

// Los 5 precios son distintos y reconocibles: solo el elegido puede salir en el PDF.
const quote = (over: Partial<PdfItemInput["quote"]> = {}): PdfItemInput["quote"] => ({
  version: 1, moneda: "MXN", price_1: 1111.11, price_2: 2222.22, price_3: 3333.33, price_4: 4444.44, price_5: 5555.55,
  entrega_dias: 10, entrega_tipo: "habiles", entrega_fecha: null,
  compra_min_cantidad: null, compra_min_unidad: null, compra_min_monto: null, valid_until: "2026-04-01T12:00:00.000Z", ...over,
});

const item = (over: Partial<PdfItemInput> = {}): PdfItemInput => ({
  id: over.folio ?? "i1", folio: "COT-2026-0001-01", producto: "Guante de carnaza", descripcion: "Para soldador, largo", cantidad: 10, unidad: "par", talla: null,
  quote: quote(), precioElegido: 3, ...over,
});

const base = (over: Partial<PdfInput> = {}): PdfInput => ({
  company, folio: "COT-2026-0001", customerName: "Pegatron Mexico", vendedorNombre: "Ana Lopez", items: [item()],
  data: { condiciones: "Credito", atencion: "Ing. Perez", destino_entrega: "Cd. Juarez, planta Pegatron", via_envio: "Parcel",
          envio: NO_SHIPPING },
  now: new Date("2026-03-17T18:00:00Z"), timezone: "America/Chihuahua", ...over,
});

async function pdfPages(model: ReturnType<typeof buildPdfModel>): Promise<string[]> {
  const logo = readFileSync(path.resolve(import.meta.dirname, "../../public/logo-esc.png"));
  const buf = await renderToBuffer(createElement(QuoteDocument, { model, logoSrc: logo }) as never);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((t) => ("str" in t ? t.str : "")).join(" "));
  }
  return pages;
}

describe("modelo del PDF", () => {
  it("encabezado y bloque de datos", () => {
    const m = buildPdfModel(base());
    expect(m).toMatchObject({ fecha: "17/03/2026", folio: "COT-2026-0001", condiciones: "Credito", asesor: "Ana Lopez", vigencia: "01/04/2026", empresa: "Pegatron Mexico", atencion: "Ing. Perez" });
    expect(m.company.rfc).toBe("RFC ERE 060228 NLA");
  });

  it("U. Price es SOLO el precio elegido y Price es U. Price por CANT", () => {
    const m = buildPdfModel(base());
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ te: "10-Business days", cant: "10 par", currency: "PESOS", uPrice: "$3,333.33", price: "$33,333.30" });
  });

  it("TE: dias naturales, fecha estimada", () => {
    const m = buildPdfModel(base({ items: [
      item({ quote: quote({ entrega_tipo: "naturales", entrega_dias: 5 }) }),
      item({ folio: "x2", quote: quote({ entrega_dias: null, entrega_tipo: null, entrega_fecha: "2026-05-01" }) }),
    ] }));
    expect(m.rows.map((r) => r.te)).toEqual(["5-Days", "01/05/2026"]);
  });

  it("talla en lugar de cantidad: CANT muestra la talla y Price = U. Price", () => {
    const m = buildPdfModel(base({ items: [item({ cantidad: null, unidad: null, talla: "M" })] }));
    expect(m.rows[0]).toMatchObject({ cant: "Talla M", price: "$3,333.33" });
  });

  it("totales por moneda: nunca mezcla pesos y dolares", () => {
    const m = buildPdfModel(base({ items: [
      item(),
      item({ folio: "x2", cantidad: 2, unidad: "pieza", precioElegido: 1, quote: quote({ moneda: "USD" }) }),
      item({ folio: "x3", cantidad: 1, unidad: "pieza", precioElegido: 2 }),
    ] }));
    expect(m.totals).toEqual([
      { currency: "PESOS", amount: "$35,555.52" }, // 33,333.30 + 2,222.22
      { currency: "DOLARES", amount: "$2,222.22" },
    ]);
  });

  // ---- Envio dentro del precio unitario -------------------------------------------------------------
  const ship = (envio: ShippingPlan, items: PdfItemInput[], over: Partial<PdfInput["data"]> = {}) =>
    buildPdfModel(base({ items, data: { ...base().data, envio, ...over } }));
  const caja = (over: Partial<PdfItemInput> = {}) => item({ cantidad: 2, unidad: "caja", ...over });

  it("2 cajas con 100 por todo el pedido: cada caja +50 y la partida +100; sin renglon de envio", () => {
    const m = ship({ modo: "por_pedido", monto: 100, moneda: "MXN" }, [caja()]);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ cant: "2 caja", uPrice: "$3,383.33", price: "$6,766.66" });
    expect(m.totals).toEqual([{ currency: "PESOS", amount: "$6,766.66" }]);
  });

  it("2 cajas con 50 por unidad: cada caja +50 y la partida +100", () => {
    const m = ship({ modo: "por_unidad", monto: 50, moneda: "MXN" }, [caja()]);
    expect(m.rows[0]).toMatchObject({ uPrice: "$3,383.33", price: "$6,766.66" });
  });

  it("varias partidas por todo el pedido: reparto proporcional a su importe", () => {
    // A: 1 x 3,333.33 y B: 2 x 1,111.11 + ... importes 3,333.33 y 2,222.22; 55.55 se reparte 33.33 / 22.22
    const m = ship({ modo: "por_pedido", monto: 55.55, moneda: "MXN" }, [
      item({ folio: "A", cantidad: 1, unidad: "pieza" }),
      item({ folio: "B", cantidad: 2, unidad: "pieza", precioElegido: 1 }),
    ]);
    expect(m.rows[0]).toMatchObject({ uPrice: "$3,366.66", price: "$3,366.66" });
    expect(m.rows[1]).toMatchObject({ uPrice: "$1,122.22", price: "$2,244.44" });
  });

  it("centavos con residuo: 100 entre tres partidas iguales sale 33.34 / 33.33 / 33.33", () => {
    const m = ship({ modo: "por_pedido", monto: 100, moneda: "MXN" }, ["A", "B", "C"].map((f) => item({ folio: f, cantidad: 1, unidad: "pieza" })));
    expect(m.rows.map((r) => r.price)).toEqual(["$3,366.67", "$3,366.66", "$3,366.66"]);
    expect(m.totals).toEqual([{ currency: "PESOS", amount: "$10,099.99" }]);
  });

  it("por partida: total de la partida (se divide entre la cantidad) o por unidad", () => {
    const m = ship({ modo: "por_partida", moneda: "MXN", partidas: { A: { monto: 120, tipo: "total" }, B: { monto: 5, tipo: "unidad" } } }, [
      item({ folio: "A" }), // 10 par: 12 por par
      item({ folio: "B", cantidad: 4, unidad: "pieza", precioElegido: 1 }),
      item({ folio: "C", cantidad: 1, unidad: "pieza", precioElegido: 2 }), // sin envio: no cambia
    ]);
    expect(m.rows[0]).toMatchObject({ uPrice: "$3,345.33", price: "$33,453.30" });
    expect(m.rows[1]).toMatchObject({ uPrice: "$1,116.11", price: "$4,464.44" });
    expect(m.rows[2]).toMatchObject({ uPrice: "$2,222.22", price: "$2,222.22" });
  });

  it("solicitud en pesos y dolares: el envio solo afecta las partidas de la moneda elegida", () => {
    const items = [item({ folio: "A" }), item({ folio: "B", cantidad: 2, unidad: "pieza", precioElegido: 1, quote: quote({ moneda: "USD" }) })];
    const usd = ship({ modo: "por_pedido", monto: 100, moneda: "USD" }, items);
    expect(usd.totals).toEqual([{ currency: "PESOS", amount: "$33,333.30" }, { currency: "DOLARES", amount: "$2,322.22" }]);
    expect(usd.rows[1]).toMatchObject({ uPrice: "$1,161.11", price: "$2,322.22" });
    const mxn = ship({ modo: "por_unidad", monto: 10, moneda: "MXN" }, items);
    expect(mxn.totals).toEqual([{ currency: "PESOS", amount: "$33,433.30" }, { currency: "DOLARES", amount: "$2,222.22" }]);
  });

  it("partida sin cantidad numerica (solo talla): cuenta como 1", () => {
    const m = ship({ modo: "por_unidad", monto: 50, moneda: "MXN" }, [item({ cantidad: null, unidad: null, talla: "M" })]);
    expect(m.rows[0]).toMatchObject({ cant: "Talla M", uPrice: "$3,383.33", price: "$3,383.33" });
  });

  it("envio vacio: el precio no cambia", () => {
    expect(ship(NO_SHIPPING, [caja()]).rows[0]).toMatchObject({ uPrice: "$3,333.33", price: "$6,666.66" });
    expect(ship({ modo: "incluido" }, [caja()]).totals).toEqual([{ currency: "PESOS", amount: "$6,666.66" }]);
  });

  it("el calculo de la vista previa coincide con el del PDF", () => {
    const plan: ShippingPlan = { modo: "por_pedido", monto: 100, moneda: "MXN" };
    const input = [caja({ folio: "A" })];
    const prev = computeOrder(input.map((i) => ({ id: i.id, cantidad: i.cantidad, precioElegido: i.precioElegido, quote: i.quote })), plan);
    const m = ship(plan, input);
    expect(prev.lines.A).toMatchObject({ precioUnitario: m.rows[0].uPrice, importe: m.rows[0].price });
    expect(prev.perCurrency[0].total).toBe(m.totals[0].amount);
    expect(prev.envioIncluido).toBe("$100.00");
    expect(computeOrder([], NO_SHIPPING).envioIncluido).toBeNull();
  });

  it("pie: la leyenda de envio va siempre que haya destino (con o sin cargo), se omite sin destino y es editable", () => {
    const INCLUDE = "Prices include shipping charges to your plant in Cd. Juarez, planta Pegatron, via Parcel";
    expect(ship(NO_SHIPPING, [item()]).footer.at(-1)).toBe(INCLUDE);
    expect(ship({ modo: "por_unidad", monto: 5, moneda: "MXN" }, [item()]).footer.at(-1)).toBe(INCLUDE);
    expect(ship(NO_SHIPPING, [item()], { destino_entrega: null }).footer).toEqual(["16% VAT will be added to the invoice", "Prices subject to change"]);
    expect(ship(NO_SHIPPING, [item()], { via_envio: null }).footer.at(-1)).toBe("Prices include shipping charges to your plant in Cd. Juarez, planta Pegatron");
    const custom = buildPdfModel(base({ company: { ...company, leyenda_envio: "Delivered to {destino} by {via}" } }));
    expect(custom.footer.at(-1)).toBe("Delivered to Cd. Juarez, planta Pegatron by Parcel");
  });

  it("compra minima: franja solo si alguna partida la tiene", () => {
    expect(buildPdfModel(base()).minimumPurchase).toBeNull();
    expect(buildPdfModel(base({ items: [item({ quote: quote({ compra_min_cantidad: 10, compra_min_unidad: "caja" }) })] })).minimumPurchase).toBe("10 caja");
    const varias = buildPdfModel(base({ items: [
      item({ quote: quote({ compra_min_monto: 1500 }) }),
      item({ folio: "x2", producto: "Casco", quote: quote({ compra_min_cantidad: 5, compra_min_unidad: "pieza" }) }),
    ] }));
    expect(varias.minimumPurchase).toBe("Guante de carnaza: $1,500.00 MXN; Casco: 5 pieza");
  });

  it("folio con revision si alguna partida va en version 2 o mas", () => {
    expect(buildPdfModel(base({ items: [item({ quote: quote({ version: 2 }) })] })).folio).toBe("COT-2026-0001-R2");
  });

  it("bloquea si falta elegir precio o si la vigencia vencio", () => {
    const sinPrecio = base({ items: [item({ precioElegido: null })] });
    expect(() => buildPdfModel(sinPrecio)).toThrow(PdfNotReadyError);
    const vencida = base({ items: [item({ quote: quote({ valid_until: "2026-03-01T00:00:00Z" }) })] });
    expect(() => buildPdfModel(vencida)).toThrow(/Vigencia vencida: solicita actualización/);
    expect(pdfProblems([{ folio: "A", precioElegido: null, quote: { valid_until: null } }], new Date())).toEqual(["Elige el precio de la partida A"]);
    expect(pdfProblems([], new Date())).toEqual(["Aun no hay partidas cotizadas"]);
  });

  it("nombre del archivo", () => {
    expect(pdfFileName("COT-2026-0001", "Pegatron México, S.A.")).toBe("COT-2026-0001_Pegatron_Mexico_S_A.pdf");
  });
});

describe("PDF generado: contenido real y PRIVACIDAD", () => {
  it("muestra los datos fijos, la tabla con encabezados exactos y SOLO el precio elegido", async () => {
    // Entrada "sucia": campos que jamas deben salir (costos, proveedor, base, otros precios).
    const dirty = base();
    (dirty.items[0] as unknown as Record<string, unknown>).costo = 99999.99;
    (dirty.items[0] as unknown as Record<string, unknown>).proveedor = "PROVEEDOR SECRETO";
    (dirty.items[0].quote as unknown as Record<string, unknown>).base = 77777.77;
    (dirty.items[0] as unknown as Record<string, unknown>).envio_proveedor = 88888.88;
    const [text] = await pdfPages(buildPdfModel(dirty));
    for (const s of ["ESC Representaciones", "Tel. (614) 424-6200", "www.elsauz.com", "ESC REPRESENTACIONES S. DE R. L. MI.", "RFC ERE 060228 NLA",
      "COTIZACION", "Fecha", "FOLIO", "COT-2026-0001", "CONDICIONES", "Credito", "ASESOR", "Ana Lopez", "VIGENCIA", "01/04/2026",
      "Empresa:", "Pegatron Mexico", "Atención:", "Ing. Perez", ...COLUMN_HEADERS, "10-Business days", "PESOS", "$3,333.33", "$33,333.30",
      "16% VAT will be added to the invoice", "Prices subject to change", "Prices include shipping charges to your plant in"]) {
      expect(text, `falta "${s}"`).toContain(s);
    }
    // Ningun otro precio, costo, base ni proveedor.
    for (const s of ["1,111.11", "2,222.22", "4,444.44", "5,555.55", "99,999.99", "99999.99", "77,777.77", "88,888.88", "PROVEEDOR", "SECRETO", "Precio 1", "Precio 5", "costo", "base"]) {
      expect(text, `no debe aparecer "${s}"`).not.toContain(s);
    }
    expect(text).not.toContain("Minimum purchase");
  });

  it("PDF con envio: solo el costo final; ni renglon Shipping, ni monto del envio, ni los 5 precios o costos", async () => {
    const dirty = base({
      items: [item({ cantidad: 2, unidad: "caja", quote: quote({ compra_min_cantidad: 10, compra_min_unidad: "caja" }) })],
      data: { ...base().data, envio: { modo: "por_pedido", monto: 100, moneda: "MXN" } },
    });
    (dirty.items[0] as unknown as Record<string, unknown>).proveedor = "PROVEEDOR SECRETO";
    (dirty.items[0] as unknown as Record<string, unknown>).costo = 4321.09;
    (dirty.items[0] as unknown as Record<string, unknown>).envio_proveedor = 88888.88;
    const [text] = await pdfPages(buildPdfModel(dirty));
    expect(text).toContain("Minimum purchase: 10 caja");
    expect(text).toContain("$3,383.33"); // U. Price con envio
    expect(text).toContain("$6,766.66"); // Price de la partida
    expect(text).toContain("TOTAL PESOS");
    expect(text).toContain("Prices include shipping charges to your plant in Cd. Juarez, planta Pegatron, via Parcel");
    for (const s of ["Shipping to", "$100.00", "$50.00", "3,333.33", "1,111.11", "2,222.22", "4,444.44", "5,555.55", "PROVEEDOR", "4,321.09", "88,888.88", "Precios sin IVA"]) {
      expect(text, `no debe aparecer "${s}"`).not.toContain(s);
    }
    expect(text.replace("shipping charges", "")).not.toMatch(/shipping/i);
  });

  it("sin envio y sin destino el PDF no lleva ninguna linea de envio", async () => {
    const [text] = await pdfPages(buildPdfModel(base({ data: { ...base().data, destino_entrega: null, via_envio: null } })));
    expect(text).not.toMatch(/shipping/i);
    expect(text).toContain("16% VAT will be added to the invoice");
  });

  it("solicitud en pesos y dolares: un total por moneda con el envio solo en la elegida", async () => {
    const m = buildPdfModel(base({
      items: [item({ folio: "A" }), item({ folio: "B", cantidad: 2, unidad: "pieza", precioElegido: 1, quote: quote({ moneda: "USD" }) })],
      data: { ...base().data, envio: { modo: "por_pedido", monto: 100, moneda: "USD" } },
    }));
    const [text] = await pdfPages(m);
    expect(text).toContain("TOTAL PESOS");
    expect(text).toContain("$33,333.30");
    expect(text).toContain("TOTAL DOLARES");
    expect(text).toContain("$2,322.22");
  });

  it("con muchas partidas el encabezado de la tabla se repite en cada pagina", async () => {
    const many = Array.from({ length: 45 }, (_, i) => item({ folio: `F${i}`, producto: `Producto ${i}`, descripcion: "Descripcion de prueba " + "x".repeat(40) }));
    const pages = await pdfPages(buildPdfModel(base({ items: many })));
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(p).toContain("U. Price");
    expect(pages[0].split("U. Price").length - 1).toBe(1); // en la primera pagina aparece una sola vez
  });
});
