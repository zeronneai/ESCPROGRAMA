import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { allocateShipping, effectiveQuantity, totalsByCurrency, type AllocLine, type ShippingPlan } from "@/lib/pricing/shipping-allocation";

const line = (id: string, precioElegido: number | string, cantidad: number | string | null, moneda: "MXN" | "USD" = "MXN"): AllocLine => ({ id, moneda, cantidad, precioElegido });
const s = (d: Decimal) => d.toFixed(2);
const run = (lines: AllocLine[], plan: ShippingPlan) => allocateShipping(lines, plan);

describe("allocateShipping: ejemplos del negocio", () => {
  it("2 cajas con 100 de envio por todo el pedido: cada caja sube 50 y la partida sube 100", () => {
    const r = run([line("a", 200, 2)], { modo: "por_pedido", monto: 100, moneda: "MXN" });
    expect(r.lines[0]).toMatchObject({});
    expect(s(r.lines[0].incremento)).toBe("50.00");
    expect(s(r.lines[0].precioUnitario)).toBe("250.00");
    expect(s(r.lines[0].importe)).toBe("500.00"); // 400 + 100
    expect(s(r.repartido)).toBe("100.00");
    expect(s(r.diferencia!)).toBe("0.00");
  });

  it("2 cajas con 50 por unidad: cada caja sube 50 y la partida sube 100", () => {
    const r = run([line("a", 200, 2)], { modo: "por_unidad", monto: 50, moneda: "MXN" });
    expect(s(r.lines[0].incremento)).toBe("50.00");
    expect(s(r.lines[0].importe)).toBe("500.00");
    expect(s(r.repartido)).toBe("100.00");
  });

  it("por unidad aplica el mismo monto a cada partida", () => {
    const r = run([line("a", 100, 3), line("b", 40, 1)], { modo: "por_unidad", monto: 5, moneda: "MXN" });
    expect(r.lines.map((l) => s(l.precioUnitario))).toEqual(["105.00", "45.00"]);
    expect(r.lines.map((l) => s(l.importe))).toEqual(["315.00", "45.00"]);
    expect(s(r.repartido)).toBe("20.00");
  });
});

describe("por todo el pedido: reparto proporcional", () => {
  it("varias partidas: proporcional al importe y luego entre las unidades de cada partida", () => {
    // A: 1 x 100 = 100; B: 3 x 200 = 600; total 700. Envio 70 -> A 10, B 60 (20 por unidad).
    const r = run([line("a", 100, 1), line("b", 200, 3)], { modo: "por_pedido", monto: 70, moneda: "MXN" });
    expect(r.lines.map((l) => s(l.incremento))).toEqual(["10.00", "20.00"]);
    expect(r.lines.map((l) => s(l.envio))).toEqual(["10.00", "60.00"]);
    expect(r.lines.map((l) => s(l.importe))).toEqual(["110.00", "660.00"]);
    expect(s(r.repartido)).toBe("70.00");
  });

  it("centavos con residuo (metodo del resto): 100 entre 3 partidas iguales suma exactamente 100.00", () => {
    const r = run([line("a", 10, 1), line("b", 10, 1), line("c", 10, 1)], { modo: "por_pedido", monto: 100, moneda: "MXN" });
    expect(r.lines.map((l) => s(l.incremento))).toEqual(["33.34", "33.33", "33.33"]);
    expect(s(r.repartido)).toBe("100.00");
    expect(s(r.diferencia!)).toBe("0.00");
  });

  it("el centavo sobrante va a la partida con mayor resto", () => {
    // importes 100 y 200 (qty 1), envio 10: 3.3333 y 6.6667 -> floor 3.33 y 6.66, falta 1 centavo -> al de mayor resto (.67)
    const r = run([line("a", 100, 1), line("b", 200, 1)], { modo: "por_pedido", monto: 10, moneda: "MXN" });
    expect(r.lines.map((l) => s(l.incremento))).toEqual(["3.33", "6.67"]);
    expect(s(r.repartido)).toBe("10.00");
  });

  it("puede diferir por centavos: 2 unidades no pueden representar 100.01", () => {
    const r = run([line("a", 200, 2)], { modo: "por_pedido", monto: 100.01, moneda: "MXN" });
    expect(s(r.lines[0].incremento)).toBe("50.00");
    expect(s(r.repartido)).toBe("100.00");
    expect(s(r.diferencia!)).toBe("-0.01");
  });

  it("agrega un centavo por unidad cuando eso deja el total mas cerca del monto", () => {
    // 1 partida de 3 unidades, envio 100: 33.3333 por unidad -> 33.33 x3 = 99.99; +1 centavo x3 = 100.02 (mas lejos) -> se queda en 99.99
    const r = run([line("a", 30, 3)], { modo: "por_pedido", monto: 100, moneda: "MXN" });
    expect(s(r.lines[0].incremento)).toBe("33.33");
    expect(s(r.repartido)).toBe("99.99");
    expect(s(r.diferencia!)).toBe("-0.01");
  });

  it("la suma repartida nunca se aleja del monto mas que la mitad de la cantidad total de unidades en centavos", () => {
    const cases: [number, [number, number][]][] = [
      [123.45, [[19.99, 3], [5, 12], [250, 1]]],
      [99.99, [[10, 7], [10, 7], [10, 7]]],
      [1, [[3, 3], [3, 3]]],
      [1000, [[1.01, 1000], [999.99, 1]]],
    ];
    for (const [monto, ls] of cases) {
      const r = run(ls.map(([p, q], i) => line(String(i), p, q)), { modo: "por_pedido", monto, moneda: "MXN" });
      const unidades = ls.reduce((a, [, q]) => a + q, 0);
      expect(r.diferencia!.abs().lte(new Decimal(unidades).div(200).plus(0.01))).toBe(true);
      for (const l of r.lines) expect(l.incremento.decimalPlaces()).toBeLessThanOrEqual(2);
    }
  });

  it("envio 0 o negativo no cambia nada", () => {
    for (const monto of [0, "0.00", -5]) {
      const r = run([line("a", 200, 2)], { modo: "por_pedido", monto, moneda: "MXN" });
      expect(s(r.lines[0].importe)).toBe("400.00");
    }
  });
});

describe("por partida", () => {
  it("por unidad y total de la partida (se divide entre la cantidad)", () => {
    const r = run([line("a", 100, 2), line("b", 50, 3), line("c", 10, 1)], {
      modo: "por_partida",
      moneda: "MXN",
      partidas: { a: { monto: 30, tipo: "unidad" }, b: { monto: 100, tipo: "total" } },
    });
    expect(r.lines.map((l) => s(l.incremento))).toEqual(["30.00", "33.33", "0.00"]);
    expect(r.lines.map((l) => s(l.importe))).toEqual(["260.00", "249.99", "10.00"]);
  });

  it("partida sin monto o con 0 no cambia", () => {
    const r = run([line("a", 100, 2)], { modo: "por_partida", moneda: "MXN", partidas: { a: { monto: 0, tipo: "unidad" } } });
    expect(s(r.lines[0].importe)).toBe("200.00");
  });
});

describe("monedas, cantidades y casos limite", () => {
  const mixed = [line("mx", 100, 2, "MXN"), line("us", 10, 5, "USD")];
  it("con pesos y dolares el reparto solo afecta a la moneda elegida", () => {
    const usd = run(mixed, { modo: "por_pedido", monto: 20, moneda: "USD" });
    expect(usd.lines.map((l) => s(l.importe))).toEqual(["200.00", "70.00"]); // dolares: 5 x (10 + 4)
    expect(s(usd.lines[1].incremento)).toBe("4.00");
    const mxn = run(mixed, { modo: "por_unidad", monto: 7, moneda: "MXN" });
    expect(mxn.lines.map((l) => s(l.importe))).toEqual(["214.00", "50.00"]);
  });

  it("totales por moneda (suma de los importes), sin mezclar", () => {
    const r = run(mixed, { modo: "por_pedido", monto: 20, moneda: "USD" });
    expect(totalsByCurrency(r.lines).map((t) => [t.moneda, s(t.total), s(t.envio)])).toEqual([
      ["MXN", "200.00", "0.00"],
      ["USD", "70.00", "20.00"],
    ]);
  });

  it("partida sin cantidad numerica (solo talla) cuenta como 1", () => {
    for (const q of [null, undefined, "", "abc", 0, -2]) {
      const r = run([line("a", 80, q as never)], { modo: "por_pedido", monto: 25, moneda: "MXN" });
      expect(s(r.lines[0].incremento)).toBe("25.00");
      expect(s(r.lines[0].importe)).toBe("105.00");
    }
    expect(effectiveQuantity("2.5").toString()).toBe("2.5");
    expect(effectiveQuantity(null).toString()).toBe("1");
  });

  it("cantidades decimales (kg): el importe usa la cantidad exacta", () => {
    const r = run([line("a", 100, "2.5")], { modo: "por_unidad", monto: 10, moneda: "MXN" });
    expect(s(r.lines[0].importe)).toBe("275.00");
  });

  it("sin envio (modo incluido) el precio no cambia", () => {
    const r = run([line("a", 123.45, 3)], { modo: "incluido" });
    expect(r.lines[0].precioUnitario.toString()).toBe("123.45");
    expect(s(r.lines[0].importe)).toBe("370.35");
    expect(r.repartido.isZero()).toBe(true);
    expect(r.moneda).toBeNull();
  });

  it("aritmetica decimal exacta (0.1 + 0.2)", () => {
    const r = run([line("a", "0.1", 3)], { modo: "por_unidad", monto: "0.2", moneda: "MXN" });
    expect(r.lines[0].precioUnitario.toString()).toBe("0.3");
    expect(s(r.lines[0].importe)).toBe("0.90");
  });

  it("sin partidas en la moneda del plan no hay nada que repartir", () => {
    const r = run([line("mx", 100, 1, "MXN")], { modo: "por_pedido", monto: 50, moneda: "USD" });
    expect(s(r.lines[0].importe)).toBe("100.00");
    expect(r.repartido.isZero()).toBe(true);
  });
});
