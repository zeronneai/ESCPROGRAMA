import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { buildPdfModel, computeOrder, type PdfInput, type PdfItemInput } from "@/lib/pdf/model";
import { QuoteDocument } from "@/lib/pdf/quote-template";
import { parseShippingSetup, presentationDefaults, storedPresentation } from "@/lib/pdf/shipping";
import { NO_SHIPPING } from "@/lib/pricing/shipping-allocation";
import { issueNumber } from "@/lib/quotes/revisions";
import { requestStage, type PipelineItem } from "@/lib/stats/seller-pipeline";
import { customerMissing, customerSchema, matchCustomer, normalizeRfc } from "@/lib/validation/customer";

const company = {
  nombre_comercial: "ESC Representaciones", razon_social: "ESC REPRESENTACIONES S. DE R. L. MI.", telefono: "(614) 424-6200",
  web: "www.elsauz.com", direccion: "Chihuahua", rfc: "RFC ERE 060228 NLA", pie_lineas: ["16% VAT will be added to the invoice"],
};
const quote = (over: Partial<PdfItemInput["quote"]> = {}): PdfItemInput["quote"] => ({
  version: 1, moneda: "MXN", price_1: 100, price_2: 90, price_3: 80, price_4: 70, price_5: 60,
  entrega_dias: 5, entrega_tipo: "habiles", entrega_fecha: null, compra_min_cantidad: null, compra_min_unidad: null, compra_min_monto: null,
  valid_until: "2026-12-01T12:00:00Z", ...over,
});
const item = (over: Partial<PdfItemInput> = {}): PdfItemInput => ({
  id: "a", folio: "COT-2026-0001-01", nombre: "Guante", cantidad: 10, unidad: "caja", talla: null, quote: quote(), precioElegido: 1, ...over,
});
const base = (data: Partial<PdfInput["data"]> = {}, over: Partial<PdfInput> = {}): PdfInput => ({
  company, folio: "COT-2026-0001", customerName: "Planta Norte", vendedorNombre: "Ana", items: [item()],
  data: { condiciones: "Credito", atencion: null, destino_entrega: "Cd. Juarez", via_envio: "Flete", envio: NO_SHIPPING, ...data },
  now: new Date("2026-10-30T18:00:00Z"), timezone: "America/Chihuahua", ...over,
});
const ctx = { currencies: ["MXN" as const], itemIds: ["a", "b"] };

describe("como ve el cliente el envio", () => {
  it("sin envio: no hay renglon ni leyenda de envio incluido", () => {
    const m = buildPdfModel(base({ presentacion: "sin_envio" }));
    expect(m.rows).toHaveLength(1);
    expect(m.totals).toEqual([{ currency: "PESOS", amount: "$1,000.00" }]);
    expect(m.footer.join(" ")).not.toMatch(/include shipping/);
  });

  it("incluido: se reparte en el precio y lleva la leyenda", () => {
    const m = buildPdfModel(base({ presentacion: "incluido", envio: { modo: "por_pedido", monto: 50, moneda: "MXN" } }));
    expect(m.rows[0]).toMatchObject({ uPrice: "$105.00", price: "$1,050.00" });
    expect(m.footer.join(" ")).toMatch(/Prices include shipping charges to your plant in Cd. Juarez, via Flete/);
  });

  it("cargo aparte: renglon 'Envio' sumado al total y sin leyenda de envio incluido", () => {
    const m = buildPdfModel(base({ presentacion: "aparte", envioAparte: { monto: 350, moneda: "MXN" } }));
    expect(m.rows[0]).toMatchObject({ uPrice: "$100.00", price: "$1,000.00" });
    expect(m.rows[1]).toMatchObject({ nombre: "Envío / Shipping", cant: "1", currency: "PESOS", uPrice: "$350.00", price: "$350.00" });
    expect(m.totals).toEqual([{ currency: "PESOS", amount: "$1,350.00" }]);
    expect(m.footer.join(" ")).not.toMatch(/include shipping/);
  });

  it("mixto: una parte en el precio y otra como renglon; el total suma ambas", () => {
    const m = buildPdfModel(base({ presentacion: "mixto", envio: { modo: "por_pedido", monto: 25, moneda: "MXN" }, envioAparte: { monto: 25, moneda: "MXN" } }));
    expect(m.rows[0]).toMatchObject({ uPrice: "$102.50", price: "$1,025.00" });
    expect(m.rows[1]).toMatchObject({ price: "$25.00" });
    expect(m.totals).toEqual([{ currency: "PESOS", amount: "$1,050.00" }]);
    expect(m.footer.join(" ")).toMatch(/include shipping/);
  });

  it("el envio aparte va en la moneda elegida y no mezcla monedas", () => {
    const items = [item(), item({ id: "b", folio: "COT-2026-0001-02", quote: quote({ moneda: "USD" }) })];
    const o = computeOrder(items, NO_SHIPPING, { monto: 20, moneda: "USD" });
    expect(o.perCurrency).toEqual([
      { currency: "PESOS", total: "$1,000.00", envio: "$0.00" },
      { currency: "DOLARES", total: "$1,020.00", envio: "$0.00" },
    ]);
    expect(o.envioAparte).toEqual({ currency: "DOLARES", amount: "$20.00" });
  });

  it("el PDF renderiza el renglon de envio y el numero de la emision", async () => {
    const m = buildPdfModel(base({ presentacion: "aparte", envioAparte: { monto: 350, moneda: "MXN" } }, { numero: "COT-2026-0001-V2" }));
    expect(m.folio).toBe("COT-2026-0001-V2");
    const logo = readFileSync(path.resolve(import.meta.dirname, "../../public/logo-esc.png"));
    const buf = await renderToBuffer(createElement(QuoteDocument, { model: m, logoSrc: logo }) as never);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((t) => ("str" in t ? t.str : "")).join(" ");
    expect(text).toContain("COT-2026-0001-V2");
    expect(text).toContain("Shipping");
    expect(text).toContain("$1,350.00");
  });
});

describe("captura del envio (parseShippingSetup)", () => {
  it("valida cada presentacion", () => {
    expect(parseShippingSetup({ presentacion: "sin_envio", modo: "por_pedido", monto: "100" }, ctx)).toMatchObject({ ok: true, plan: { modo: "incluido" }, aparte: null, db: { modo: "incluido", presentacion: "sin_envio" } });
    expect(parseShippingSetup({ presentacion: "incluido", modo: "por_pedido", monto: "" }, ctx)).toMatchObject({ ok: false });
    expect(parseShippingSetup({ presentacion: "incluido", modo: "incluido", monto: "80" }, ctx)).toMatchObject({ ok: true, plan: { modo: "por_pedido", monto: 80 } });
    expect(parseShippingSetup({ presentacion: "aparte", modo: "incluido", aparteMonto: "0" }, ctx)).toMatchObject({ ok: false });
    expect(parseShippingSetup({ presentacion: "aparte", modo: "por_pedido", monto: "99", aparteMonto: "1,250.555" }, ctx)).toMatchObject({
      ok: true, plan: { modo: "incluido" }, aparte: { monto: 1250.56, moneda: "MXN" }, db: { modo: "incluido", aparte_monto: 1250.56 },
    });
    expect(parseShippingSetup({ presentacion: "mixto", modo: "por_pedido", monto: "25", aparteMonto: "25" }, ctx)).toMatchObject({ ok: true, plan: { modo: "por_pedido" }, aparte: { monto: 25 } });
    expect(parseShippingSetup({ presentacion: "aparte", modo: "incluido", aparteMonto: "10" }, { ...ctx, currencies: ["MXN", "USD"] })).toMatchObject({ ok: false, error: expect.stringMatching(/moneda/) });
  });

  it("lo guardado antes de esta opcion se interpreta como antes", () => {
    expect(storedPresentation({ envio_modo: "por_pedido" })).toBeNull();
    expect(presentationDefaults({ envio_modo: "por_pedido", envio_monto: 100 })).toEqual({ presentacion: "incluido", aparteMonto: "" });
    expect(presentationDefaults({ envio_modo: "incluido" })).toEqual({ presentacion: "sin_envio", aparteMonto: "" });
    expect(presentationDefaults({ envio_presentacion: "aparte", envio_aparte_monto: "300.00" })).toEqual({ presentacion: "aparte", aparteMonto: "300" });
  });
});

describe("numero de la cotizacion enviada", () => {
  it("folio, revision del comprador y recotizacion", () => {
    expect(issueNumber("COT-2026-0040", 1, 1)).toBe("COT-2026-0040");
    expect(issueNumber("COT-2026-0040", 1, 2)).toBe("COT-2026-0040-V2");
    expect(issueNumber("COT-2026-0040", 2, 1)).toBe("COT-2026-0040-R2");
    expect(issueNumber("COT-2026-0040", 2, 3)).toBe("COT-2026-0040-R2-V3");
  });
});

describe("etapa de la solicitud para el vendedor", () => {
  const NOW = new Date("2026-10-30T18:00:00Z");
  const it_ = (over: Partial<PipelineItem> = {}): PipelineItem => ({ estado: "pendiente", item_quotes: [], item_dispatch: [], item_outcomes: [], ...over });
  const q = { version: 1, valid_until: "2026-11-15T00:00:00Z" };
  const sent = (days: number) => ({ quote_version: 1, enviado_at: new Date(NOW.getTime() - days * 86_400_000).toISOString() });

  it("prioriza lo que requiere accion del vendedor", () => {
    expect(requestStage({ items: [it_(), it_({ estado: "cotizada", item_quotes: [q] })], renegotiationOpen: false, lastSentAt: null }, NOW)).toMatchObject({ stage: "por_enviar", action: { tone: "amber" } });
    expect(requestStage({ items: [it_({ estado: "esperando_aclaracion" }), it_({ estado: "cotizada", item_quotes: [q] })], renegotiationOpen: false, lastSentAt: null }, NOW).stage).toBe("aclaracion");
    expect(requestStage({ items: [it_({ estado: "enviada_cliente", item_quotes: [q], item_dispatch: [sent(1)] })], renegotiationOpen: true, lastSentAt: null }, NOW).stage).toBe("recotizando");
    expect(requestStage({ items: [it_()], renegotiationOpen: false, lastSentAt: null }, NOW)).toMatchObject({ stage: "con_compras", action: null });
  });

  it("con el cliente: seguimiento a los 5 dias y vigencia vencida en rojo", () => {
    const enviada = it_({ estado: "enviada_cliente", item_quotes: [q], item_dispatch: [sent(2)] });
    expect(requestStage({ items: [enviada], renegotiationOpen: false, lastSentAt: sent(2).enviado_at }, NOW)).toMatchObject({ stage: "con_cliente", action: null, diasSinRespuesta: 2 });
    expect(requestStage({ items: [enviada], renegotiationOpen: false, lastSentAt: sent(6).enviado_at }, NOW).action).toMatchObject({ tone: "indigo" });
    const vencida = it_({ estado: "enviada_cliente", item_quotes: [{ version: 1, valid_until: "2026-10-01T00:00:00Z" }], item_dispatch: [sent(9)] });
    expect(requestStage({ items: [vencida], renegotiationOpen: false, lastSentAt: sent(9).enviado_at }, NOW).action).toMatchObject({ tone: "red" });
  });

  it("cerradas: ganada si alguna partida se gano, perdida si todas se perdieron, sin cotizar si ninguna se encontro", () => {
    const g = it_({ estado: "enviada_cliente", item_quotes: [q], item_dispatch: [sent(3)], item_outcomes: [{ quote_version: 1, resultado: "ganada" }] });
    const p = it_({ estado: "enviada_cliente", item_quotes: [q], item_dispatch: [sent(3)], item_outcomes: [{ quote_version: 1, resultado: "perdida" }] });
    expect(requestStage({ items: [g, p], renegotiationOpen: false, lastSentAt: null }, NOW)).toMatchObject({ stage: "ganada", counts: { ganadas: 1, perdidas: 1 } });
    expect(requestStage({ items: [p], renegotiationOpen: false, lastSentAt: null }, NOW).stage).toBe("perdida");
    expect(requestStage({ items: [it_({ estado: "no_encontrada" })], renegotiationOpen: false, lastSentAt: null }, NOW).stage).toBe("cerrada");
  });
});

describe("clientes", () => {
  const ok = { tipo: "cliente" as const, giro: "Electrónica", estado_geo: "Chihuahua", nombre: "Planta Norte", rfc: "abc-010101 ab1", direccion: "Av. Industrial 100, Cd. Juarez", contacto_telefono: "656 123 4567" };
  it("normaliza y valida el RFC; exige direccion y telefono o correo", () => {
    expect(normalizeRfc(" abc-010101.ab1 ")).toBe("ABC010101AB1");
    expect(customerSchema.parse(ok).rfc).toBe("ABC010101AB1");
    expect(customerSchema.safeParse({ ...ok, rfc: "XEXX010101000" }).success).toBe(true);
    expect(customerSchema.safeParse({ ...ok, rfc: "123" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...ok, direccion: "x" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...ok, contacto_telefono: "" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...ok, contacto_telefono: "", contacto_correo: "compras@norte.mx" }).success).toBe(true);
    // Prospecto: el RFC es opcional; cliente: obligatorio. Giro y estado siempre.
    expect(customerSchema.safeParse({ ...ok, tipo: "prospecto", rfc: "" }).success).toBe(true);
    expect(customerSchema.safeParse({ ...ok, tipo: "cliente", rfc: "" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...ok, giro: "" }).success).toBe(false);
  });
  it("faltantes y busqueda sin acentos", () => {
    const c = { id: "1", tipo: "prospecto" as const, giro: "Óptica", estado_geo: "Chihuahua", nombre: "Óptica Juárez", razon_social: null, rfc: null, direccion: null, contacto_nombre: "Ana", contacto_telefono: null, contacto_correo: null, activo: true };
    expect(customerMissing(c)).toEqual(["RFC", "dirección", "teléfono o correo"]);
    expect(matchCustomer(c, "optica juarez")).toBe(true);
    expect(matchCustomer(c, "ana")).toBe(true);
    expect(matchCustomer(c, "bosch")).toBe(false);
  });
});
