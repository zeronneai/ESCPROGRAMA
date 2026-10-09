import { describe, expect, it } from "vitest";
import { formatPriceTable, type PriceTableItem } from "@/lib/format/price-table";

const item: PriceTableItem = {
  folio: "COT-2026-0001-01",
  producto: "Guante de carnaza",
  descripcion: "Guante para soldador <largo>",
  cantidad: 10,
  unidad: "par",
  moneda: "MXN",
  entrega: "5 dias habiles",
  compraMinima: "5 pares",
  precios: ["121.68", "131.04", "140.40", "148.72", "1600.16"],
  precioElegido: 3,
};

describe("formatPriceTable", () => {
  it("texto plano ordenado con los 5 precios y totales", () => {
    const { text } = formatPriceTable([item]);
    expect(text).toContain("COT-2026-0001-01 - Guante de carnaza");
    expect(text).toContain("Cantidad: 10 par");
    expect(text).toContain("Compra minima: 5 pares");
    expect(text).toContain("Precio 1: $121.68 MXN c/u (total $1,216.80 MXN)");
    expect(text).toContain("Precio 5: $1,600.16 MXN c/u");
    expect(text.match(/Precio \d:/g)).toHaveLength(5);
  });

  it("solo el precio seleccionado", () => {
    const { text, html } = formatPriceTable([item], { onlySelected: true });
    expect(text.match(/Precio \d:/g)).toEqual(["Precio 3:"]);
    expect(html).toContain("Precio 3");
    expect(html).not.toContain("Precio 1<");
  });

  it("sin cantidad no muestra totales; con talla la muestra", () => {
    const { text, html } = formatPriceTable([
      { ...item, cantidad: null, unidad: null, talla: "M" },
    ]);
    expect(text).toContain("Cantidad: Talla M");
    expect(text).not.toContain("total");
    expect(html).not.toContain(">Total<");
  });

  it("escapa html", () => {
    const { html } = formatPriceTable([item]);
    expect(html).toContain("&lt;largo&gt;");
    expect(html).not.toContain("<largo>");
  });

  it("varias partidas se separan", () => {
    const { text, html } = formatPriceTable([item, { ...item, folio: "COT-2026-0001-02" }]);
    expect(text.split("\n\n")).toHaveLength(2);
    expect(html.match(/<table/g)).toHaveLength(2);
  });

  it("no filtra campos sensibles aunque se pasen de mas", () => {
    const dirty = { ...item, costo: "99", envio: "5", proveedor: "ACME", base: "104" };
    const { text, html } = formatPriceTable([dirty as PriceTableItem]);
    for (const s of ["99.00", "ACME", "104", "proveedor", "costo", "envio"]) {
      expect(text).not.toContain(s);
      expect(html).not.toContain(s);
    }
  });
});
