import { describe, expect, it } from "vitest";
import { DEFAULT_SHIPPING_LEGEND, parseShippingPlan, planFromStored, renderShippingLegend } from "@/lib/pdf/shipping";

const ctx = (currencies: ("MXN" | "USD")[] = ["MXN"], itemIds = ["a", "b"]) => ({ currencies, itemIds });

describe("parseShippingPlan", () => {
  it("sin envio, monto vacio o 0: el precio no cambia", () => {
    for (const modo of ["incluido", "por_unidad", "por_pedido"] as const) {
      for (const monto of [undefined, "", "  ", "0", "0.00"]) {
        const r = parseShippingPlan({ modo, monto }, ctx());
        expect(r).toMatchObject({ ok: true, plan: { modo: "incluido" }, db: { modo: "incluido", monto: null, moneda: null, partidas: [] } });
      }
    }
  });

  it("por unidad y por todo el pedido: moneda por defecto = la de las partidas", () => {
    expect(parseShippingPlan({ modo: "por_unidad", monto: "50" }, ctx(["USD"]))).toMatchObject({ ok: true, plan: { modo: "por_unidad", monto: 50, moneda: "USD" } });
    expect(parseShippingPlan({ modo: "por_pedido", monto: "1,250.50", moneda: "MXN" }, ctx())).toMatchObject({ ok: true, db: { modo: "por_pedido", monto: 1250.5, moneda: "MXN" } });
  });

  it("si la solicitud mezcla pesos y dolares exige elegir la moneda", () => {
    const mixed = ctx(["MXN", "USD"]);
    expect(parseShippingPlan({ modo: "por_pedido", monto: "100", moneda: "" }, mixed)).toMatchObject({ ok: false });
    expect(parseShippingPlan({ modo: "por_pedido", monto: "100", moneda: "USD" }, mixed)).toMatchObject({ ok: true, plan: { moneda: "USD" } });
    expect(parseShippingPlan({ modo: "por_partida", moneda: "", partidas: [{ itemId: "a", monto: "5", tipo: "unidad" }] }, mixed)).toMatchObject({ ok: false });
  });

  it("montos invalidos o negativos", () => {
    expect(parseShippingPlan({ modo: "por_unidad", monto: "abc" }, ctx())).toMatchObject({ ok: false });
    expect(parseShippingPlan({ modo: "por_pedido", monto: "-5" }, ctx())).toMatchObject({ ok: false });
    expect(parseShippingPlan({ modo: "por_partida", partidas: [{ itemId: "a", monto: "-1", tipo: "total" }] }, ctx())).toMatchObject({ ok: false });
  });

  it("por partida: ignora vacias, ceros y partidas ajenas; conserva por unidad o total", () => {
    const r = parseShippingPlan(
      { modo: "por_partida", partidas: [
        { itemId: "a", monto: "30", tipo: "unidad" }, { itemId: "b", monto: "", tipo: "total" }, { itemId: "zz", monto: "99", tipo: "total" },
      ] },
      ctx(),
    );
    expect(r).toMatchObject({ ok: true, plan: { modo: "por_partida", moneda: "MXN", partidas: { a: { monto: 30, tipo: "unidad" } } }, db: { partidas: [{ item_id: "a", monto: 30, tipo: "unidad" }] } });
    expect(parseShippingPlan({ modo: "por_partida", partidas: [{ itemId: "a", monto: "0", tipo: "unidad" }] }, ctx())).toMatchObject({ ok: true, plan: { modo: "incluido" } });
  });
});

describe("planFromStored (lo guardado en la base)", () => {
  it("el modo legado 'aparte' se trata como 'por todo el pedido'", () => {
    expect(planFromStored({ envio_modo: "aparte", envio_monto: "350.00", envio_moneda: "MXN" })).toEqual({ modo: "por_pedido", monto: 350, moneda: "MXN" });
  });
  it("modos nuevos y sin envio", () => {
    expect(planFromStored({ envio_modo: "por_unidad", envio_monto: 50, envio_moneda: "USD" })).toEqual({ modo: "por_unidad", monto: 50, moneda: "USD" });
    expect(planFromStored({ envio_modo: "incluido", envio_monto: null, envio_moneda: null })).toEqual({ modo: "incluido" });
    expect(planFromStored(null)).toEqual({ modo: "incluido" });
    expect(planFromStored({ envio_modo: "por_pedido", envio_monto: 0, envio_moneda: "MXN" })).toEqual({ modo: "incluido" });
  });
  it("por partida", () => {
    expect(
      planFromStored({ envio_modo: "por_partida", envio_monto: null, envio_moneda: "MXN" }, [
        { item_id: "a", monto: "30.00", tipo: "unidad" }, { item_id: "b", monto: "0", tipo: "total" },
      ]),
    ).toEqual({ modo: "por_partida", moneda: "MXN", partidas: { a: { monto: 30, tipo: "unidad" } } });
  });
});

describe("leyenda de envio del pie (editable en Configuracion)", () => {
  it("usa destino y via; sin destino se omite; sin via se omite la via", () => {
    expect(renderShippingLegend(DEFAULT_SHIPPING_LEGEND, "Cd. Juarez", "Parcel")).toBe("Prices include shipping charges to your plant in Cd. Juarez, via Parcel");
    expect(renderShippingLegend(DEFAULT_SHIPPING_LEGEND, "Cd. Juarez", "")).toBe("Prices include shipping charges to your plant in Cd. Juarez");
    expect(renderShippingLegend(DEFAULT_SHIPPING_LEGEND, null, "Parcel")).toBeNull();
    expect(renderShippingLegend(DEFAULT_SHIPPING_LEGEND, "   ", "Parcel")).toBeNull();
  });
  it("plantilla personalizada y por defecto cuando esta vacia", () => {
    expect(renderShippingLegend("Envio incluido a {destino} por {via}", "Chihuahua", "Flete")).toBe("Envio incluido a Chihuahua por Flete");
    expect(renderShippingLegend("Envio incluido a {destino} por {via}", "Chihuahua", null)).toBe("Envio incluido a Chihuahua");
    expect(renderShippingLegend("", "Chihuahua", "Flete")).toBe("Prices include shipping charges to your plant in Chihuahua, via Flete");
    expect(renderShippingLegend(null, "Chihuahua", null)).toBe("Prices include shipping charges to your plant in Chihuahua");
  });
});
