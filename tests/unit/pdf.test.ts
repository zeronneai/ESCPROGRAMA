import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { buildPdfModel, COLUMN_HEADERS, itemCurrencies, pdfFileName, pdfProblems, PdfNotReadyError, previewTotals, resolveShippingCurrency, type PdfInput, type PdfItemInput } from "@/lib/pdf/model";
import { parseShippingInput } from "@/lib/pdf/shipping";
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
  folio: "COT-2026-0001-01", producto: "Guante de carnaza", descripcion: "Para soldador, largo", cantidad: 10, unidad: "par", talla: null,
  quote: quote(), precioElegido: 3, ...over,
});

const base = (over: Partial<PdfInput> = {}): PdfInput => ({
  company, folio: "COT-2026-0001", customerName: "Pegatron Mexico", vendedorNombre: "Ana Lopez", items: [item()],
  data: { condiciones: "Credito", atencion: "Ing. Perez", destino_entrega: "Cd. Juarez, planta Pegatron", via_envio: "Parcel",
          envio_monto: null, envio_moneda: null },
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

  const withShipping = (monto: number | string | null, moneda: "MXN" | "USD" | null, over: Partial<PdfInput["data"]> = {}) =>
    base({ data: { ...base().data, envio_monto: monto, envio_moneda: moneda, ...over } });
  const INCLUDE = "Prices include shipping charges to your plant in Cd. Juarez, planta Pegatron, via Parcel";

  it("envio mayor a 0: renglon Shipping to <destino> via <via>, suma al total de su moneda y SIN leyenda de incluido", () => {
    const m = buildPdfModel(withShipping(350, "MXN"));
    expect(m.rows.at(-1)).toMatchObject({ nombre: "Shipping to Cd. Juarez, planta Pegatron via Parcel", cant: "1", uPrice: "$350.00", price: "$350.00", currency: "PESOS", te: "" });
    expect(m.totals).toEqual([{ currency: "PESOS", amount: "$33,683.30" }]);
    expect(m.footer).toEqual(["16% VAT will be added to the invoice", "Prices subject to change"]);
    expect(m.footer.some((l) => l.includes("Prices include shipping"))).toBe(false);
  });

  it("envio vacio o 0 CON destino: leyenda de incluido en el pie y sin renglon de envio", () => {
    for (const monto of [null, 0, "", "0"]) {
      const m = buildPdfModel(withShipping(monto, null));
      expect(m.rows).toHaveLength(1);
      expect(m.footer.at(-1)).toBe(INCLUDE);
      expect(m.totals).toEqual([{ currency: "PESOS", amount: "$33,333.30" }]);
    }
  });

  it("envio vacio SIN destino: ninguna linea de envio (ni renglon ni leyenda)", () => {
    const m = buildPdfModel(withShipping(null, null, { destino_entrega: null }));
    expect(m.rows).toHaveLength(1);
    expect(m.footer).toEqual(["16% VAT will be added to the invoice", "Prices subject to change"]);
    const vacio = buildPdfModel(withShipping(null, null, { destino_entrega: "   " }));
    expect(vacio.footer).toHaveLength(2);
  });

  it("sin via de envio: el renglon y la leyenda omiten la via", () => {
    expect(buildPdfModel(withShipping(100, "MXN", { via_envio: null })).rows.at(-1)!.nombre).toBe("Shipping to Cd. Juarez, planta Pegatron");
    expect(buildPdfModel(withShipping(null, null, { via_envio: null })).footer.at(-1)).toBe("Prices include shipping charges to your plant in Cd. Juarez, planta Pegatron");
    expect(buildPdfModel(withShipping(100, "MXN", { via_envio: null, destino_entrega: null })).rows.at(-1)!.nombre).toBe("Shipping");
  });

  it("moneda del envio: por defecto la de las partidas si es una sola", () => {
    const m = buildPdfModel(withShipping(40, null)); // partidas en pesos
    expect(m.rows.at(-1)).toMatchObject({ currency: "PESOS", price: "$40.00" });
    const usd = buildPdfModel(base({ items: [item({ quote: quote({ moneda: "USD" }) })], data: { ...base().data, envio_monto: 40, envio_moneda: null } }));
    expect(usd.totals).toEqual([{ currency: "DOLARES", amount: "$33,373.30" }]);
  });

  describe("solicitud con pesos y dolares", () => {
    const mixed = (monto: number | null, moneda: "MXN" | "USD" | null) =>
      base({
        items: [item(), item({ folio: "x2", cantidad: 2, unidad: "pieza", precioElegido: 1, quote: quote({ moneda: "USD" }) })],
        data: { ...base().data, envio_monto: monto, envio_moneda: moneda },
      });

    it("sin elegir moneda el cargo de envio bloquea el PDF", () => {
      expect(() => buildPdfModel(mixed(350, null))).toThrow(/Elige la moneda del costo de envío al cliente/);
    });
    it("el cargo se suma SOLO al total de la moneda elegida", () => {
      expect(buildPdfModel(mixed(350, "USD")).totals).toEqual([
        { currency: "PESOS", amount: "$33,333.30" },
        { currency: "DOLARES", amount: "$2,572.22" }, // 2 x 1,111.11 + 350
      ]);
      expect(buildPdfModel(mixed(350, "MXN")).totals).toEqual([
        { currency: "PESOS", amount: "$33,683.30" },
        { currency: "DOLARES", amount: "$2,222.22" },
      ]);
    });
    it("sin cargo no exige moneda", () => {
      expect(buildPdfModel(mixed(null, null)).totals).toHaveLength(2);
    });
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

  it("envio al cliente > 0, franja amarilla de compra minima y totales por moneda en el PDF", async () => {
    const m = buildPdfModel(base({
      items: [item({ quote: quote({ compra_min_cantidad: 10, compra_min_unidad: "caja" }) }), item({ folio: "x2", producto: "Casco", precioElegido: 1, quote: quote({ moneda: "USD" }) })],
      data: { ...base().data, envio_monto: 350, envio_moneda: "MXN" },
    }));
    const [text] = await pdfPages(m);
    expect(text).toContain("Minimum purchase: 10 caja");
    expect(text).toContain("Shipping to Cd. Juarez, planta Pegatron via Parcel");
    expect(text).toContain("TOTAL PESOS");
    expect(text).toContain("$33,683.30");
    expect(text).toContain("TOTAL DOLARES");
    expect(text).toContain("DOLARES");
    expect(text).not.toContain("Prices include shipping");
  });

  it("sin cargo de envio y sin destino el PDF no lleva ninguna linea de envio; los 5 precios, costos y proveedor siguen fuera", async () => {
    const dirty = base({ data: { ...base().data, destino_entrega: null, via_envio: null } });
    (dirty.items[0] as unknown as Record<string, unknown>).proveedor = "PROVEEDOR SECRETO";
    (dirty.items[0] as unknown as Record<string, unknown>).costo = 4321.09;
    const [text] = await pdfPages(buildPdfModel(dirty));
    expect(text).not.toContain("Shipping");
    expect(text).not.toContain("Prices include shipping");
    expect(text).toContain("16% VAT will be added to the invoice");
    for (const s of ["1,111.11", "2,222.22", "4,444.44", "5,555.55", "PROVEEDOR", "4,321.09", "Precios sin IVA"]) {
      expect(text, `no debe aparecer "${s}"`).not.toContain(s);
    }
  });

  it("envio vacio con destino: el PDF trae la leyenda de incluido y ningun renglon Shipping", async () => {
    const [text] = await pdfPages(buildPdfModel(base()));
    expect(text).toContain("Prices include shipping charges to your plant in Cd. Juarez, planta Pegatron, via Parcel");
    expect(text).not.toContain("Shipping to");
  });

  it("solicitud en pesos y dolares: el PDF muestra un total por moneda con el envio solo en la elegida", async () => {
    const m = buildPdfModel(base({
      items: [item(), item({ folio: "x2", cantidad: 2, unidad: "pieza", precioElegido: 1, quote: quote({ moneda: "USD" }) })],
      data: { ...base().data, envio_monto: 100, envio_moneda: "USD" },
    }));
    const [text] = await pdfPages(m);
    expect(text).toContain("TOTAL PESOS");
    expect(text).toContain("$33,333.30");
    expect(text).toContain("TOTAL DOLARES");
    expect(text).toContain("$2,322.22");
    expect(text).toContain("Shipping to Cd. Juarez, planta Pegatron via Parcel");
  });

  it("con muchas partidas el encabezado de la tabla se repite en cada pagina", async () => {
    const many = Array.from({ length: 45 }, (_, i) => item({ folio: `F${i}`, producto: `Producto ${i}`, descripcion: "Descripcion de prueba " + "x".repeat(40) }));
    const pages = await pdfPages(buildPdfModel(base({ items: many })));
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(p).toContain("U. Price");
    expect(pages[0].split("U. Price").length - 1).toBe(1); // en la primera pagina aparece una sola vez
  });
});

describe("vista previa del total por moneda (panel del vendedor)", () => {
  const lines = (over: Partial<PdfItemInput> = {}) => [{ cantidad: 10, precioElegido: 3, quote: quote(), ...over }];
  it("subtotal, envio al cliente y total con envio", () => {
    const r = previewTotals(lines(), { monto: 350, moneda: "MXN" });
    expect(r.problem).toBeNull();
    expect(r.perCurrency).toEqual([{ currency: "PESOS", subtotal: "$33,333.30", shipping: "$350.00", total: "$33,683.30" }]);
  });
  it("sin envio: sin renglon de envio y total = subtotal", () => {
    expect(previewTotals(lines(), { monto: null, moneda: null }).perCurrency).toEqual([{ currency: "PESOS", subtotal: "$33,333.30", shipping: null, total: "$33,333.30" }]);
    expect(previewTotals(lines(), { monto: 0, moneda: "MXN" }).perCurrency[0].shipping).toBeNull();
  });
  it("pesos y dolares por separado; el envio solo a su moneda; avisa si falta elegirla", () => {
    const mixed = [...lines(), { cantidad: 2, precioElegido: 1, quote: quote({ moneda: "USD" }) }];
    const r = previewTotals(mixed, { monto: 100, moneda: "USD" });
    expect(r.perCurrency.map((c) => [c.currency, c.shipping, c.total])).toEqual([["PESOS", null, "$33,333.30"], ["DOLARES", "$100.00", "$2,322.22"]]);
    expect(previewTotals(mixed, { monto: 100, moneda: null }).problem).toMatch(/Elige la moneda/);
  });
  it("las partidas sin precio elegido no cuentan", () => {
    expect(previewTotals(lines({ precioElegido: null }), { monto: null, moneda: null }).perCurrency).toEqual([]);
  });
  it("coincide con el total del PDF", () => {
    const pre = previewTotals(lines(), { monto: 350, moneda: "MXN" });
    const pdf = buildPdfModel(base({ data: { ...base().data, envio_monto: 350, envio_moneda: "MXN" } }));
    expect(pdf.totals).toEqual([{ currency: "PESOS", amount: pre.perCurrency[0].total }]);
  });
  it("monedas de las partidas y moneda del envio", () => {
    expect(itemCurrencies([{ quote: quote() }, { quote: quote({ moneda: "USD" }) }, { quote: null }])).toEqual(["MXN", "USD"]);
    expect(resolveShippingCurrency(["MXN"], 50, null)).toEqual({ moneda: "MXN", problem: null });
    expect(resolveShippingCurrency(["MXN", "USD"], 50, "USD")).toEqual({ moneda: "USD", problem: null });
    expect(resolveShippingCurrency(["MXN", "USD"], 50, null).problem).toMatch(/Elige la moneda/);
    expect(resolveShippingCurrency(["MXN", "USD"], 0, null)).toEqual({ moneda: null, problem: null });
  });
});

describe("parseShippingInput (costo de envio al cliente)", () => {
  it("vacio o 0 = sin cargo", () => {
    for (const monto of [undefined, "", "  ", "0", "0.00"]) expect(parseShippingInput({ monto }, ["MXN"])).toEqual({ ok: true, monto: null, moneda: null });
  });
  it("mayor a 0 usa la moneda elegida o la unica de las partidas", () => {
    expect(parseShippingInput({ monto: "1,250.50", moneda: "USD" }, ["MXN"])).toEqual({ ok: true, monto: 1250.5, moneda: "USD" });
    expect(parseShippingInput({ monto: "350", moneda: "" }, ["MXN"])).toEqual({ ok: true, monto: 350, moneda: "MXN" });
  });
  it("si mezcla pesos y dolares exige elegir la moneda", () => {
    expect(parseShippingInput({ monto: "350", moneda: "" }, ["MXN", "USD"])).toMatchObject({ ok: false });
    expect(parseShippingInput({ monto: "350", moneda: "MXN" }, ["MXN", "USD"])).toEqual({ ok: true, monto: 350, moneda: "MXN" });
  });
  it("rechaza montos invalidos o negativos", () => {
    expect(parseShippingInput({ monto: "abc" }, ["MXN"])).toMatchObject({ ok: false });
    expect(parseShippingInput({ monto: "-5" }, ["MXN"])).toMatchObject({ ok: false });
  });
});
