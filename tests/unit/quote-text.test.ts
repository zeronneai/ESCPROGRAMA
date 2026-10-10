import { describe, expect, it } from "vitest";
import { formatPriceTable } from "@/lib/format/price-table";
import { formatDelivery, formatMinPurchase, toPriceTableItem } from "@/lib/format/quote-text";

const quote = {
  moneda: "MXN" as const, price_1: "160.16", price_2: "148.72", price_3: "140.40", price_4: "131.04", price_5: "121.68",
  entrega_dias: 5, entrega_tipo: "habiles" as const, entrega_fecha: null,
  compra_min_cantidad: null, compra_min_unidad: null, compra_min_monto: null,
};

describe("formatDelivery / formatMinPurchase", () => {
  it("dias habiles, naturales, fecha y por confirmar", () => {
    expect(formatDelivery(quote)).toBe("5 dias habiles");
    expect(formatDelivery({ entrega_dias: 1, entrega_tipo: "naturales", entrega_fecha: null })).toBe("1 dia naturales");
    expect(formatDelivery({ entrega_dias: null, entrega_tipo: null, entrega_fecha: "2026-05-01" })).toBe("Fecha estimada 01/05/2026");
    expect(formatDelivery({ entrega_dias: null, entrega_tipo: null, entrega_fecha: null })).toBe("Por confirmar");
  });
  it("compra minima por cantidad, monto o ninguna", () => {
    expect(formatMinPurchase({ ...quote, compra_min_cantidad: "10.000", compra_min_unidad: "caja" })).toBe("10 caja");
    expect(formatMinPurchase({ ...quote, compra_min_monto: "1500" })).toBe("$1,500.00 MXN");
    expect(formatMinPurchase(quote)).toBeNull();
    // Minimo 1 no es una condicion para el cliente; una cotizacion anterior sin cantidad se asume con minimo 1.
    expect(formatMinPurchase({ ...quote, compra_min_cantidad: 1, compra_min_unidad: "pieza" })).toBeNull();
    expect(formatMinPurchase({ ...quote, compra_min_cantidad: 10, compra_min_unidad: "caja", compra_min_monto: 1500 })).toBe("10 caja / $1,500.00 MXN");
  });

  it("la tabla copiada incluye la compra minima solo cuando es mayor a 1", () => {
    const item = { folio: "F-1", producto: "Guante", cantidad: 10, unidad: "caja", talla: null };
    const con = formatPriceTable([toPriceTableItem(item, { ...quote, compra_min_cantidad: 5, compra_min_unidad: "caja" }, 3)], { onlySelected: true });
    expect(con.text).toContain("Compra minima: 5 caja");
    expect(con.html).toContain("Compra minima");
    const uno = formatPriceTable([toPriceTableItem(item, { ...quote, compra_min_cantidad: 1, compra_min_unidad: "caja" }, 3)]);
    expect(uno.text).not.toContain("Compra minima");
  });
});

describe("toPriceTableItem", () => {
  it("construye la tabla del vendedor sin campos sensibles", () => {
    const item = { folio: "COT-2026-0001-01", producto: "Guante", descripcion: "guante para hacer tamales", cantidad: "10.000", unidad: "par", talla: null };
    const dirty = { ...quote, costo: "100", envio: "10", proveedor: "ACME", base: "104" };
    const pti = toPriceTableItem(item, dirty, 3);
    expect(JSON.stringify(pti)).not.toMatch(/ACME|"costo"|"base"|"envio"/);
    const { text } = formatPriceTable([pti], { onlySelected: true });
    expect(text).toContain("Precio 3: $140.40 MXN c/u (total $1,404.00 MXN)");
    expect(text).toContain("Precios sin IVA");
    // La descripcion/uso (interno) no pasa a lo que se copia, aunque venga en la partida.
    expect(JSON.stringify(pti)).not.toMatch(/tamales|descripcion/);
    expect(text).not.toContain("tamales");
  });
});
