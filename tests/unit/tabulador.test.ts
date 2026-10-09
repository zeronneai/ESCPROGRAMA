import { describe, expect, it } from "vitest";
import { DEFAULT_FACTORS, calcTabulador, lineTotal } from "@/lib/pricing/tabulador";

describe("calcTabulador", () => {
  it("ejemplo 1: sin envio agrega 4% (base 104)", () => {
    expect(calcTabulador(100, null)).toEqual({
      base: "104.00",
      p5: "121.68",
      p4: "131.04",
      p3: "140.40",
      p2: "148.72",
      p1: "160.16",
    });
  });

  it("ejemplo 2: con envio base = costo + envio (110)", () => {
    expect(calcTabulador(100, 10)).toEqual({
      base: "110.00",
      p5: "128.70",
      p4: "138.60",
      p3: "148.50",
      p2: "157.30",
      p1: "169.40",
    });
  });

  it.each([[0], [null], [undefined], [""], ["0"]])(
    "envio %j equivale a sin envio",
    (shipping) => {
      expect(calcTabulador(100, shipping as never).base).toBe("104.00");
    },
  );

  it("no sufre errores de punto flotante (0.1 + 0.2)", () => {
    expect(calcTabulador("0.1", "0.2").base).toBe("0.30");
  });

  it("redondea la mitad hacia arriba solo al final", () => {
    // 1.15 * 1.17 = 1.3455 -> 1.35
    const r = calcTabulador("1.15", "0.0001", {
      ...DEFAULT_FACTORS,
    });
    expect(r.p5).toBe("1.35");
    // 10.01 sin envio: base 10.4104, p5 = 12.180168 -> 12.18
    expect(calcTabulador("10.01", 0).p5).toBe("12.18");
  });

  it("usa los factores recibidos (snapshot) y no los de default", () => {
    const factors = { ...DEFAULT_FACTORS, noShippingMarkup: "0.10", p5: "2" };
    const r = calcTabulador(100, 0, factors);
    expect(r.base).toBe("110.00");
    expect(r.p5).toBe("220.00");
    // Los factores por default siguen dando el resultado original.
    expect(calcTabulador(100, 0).p5).toBe("121.68");
  });

  it("rechaza valores negativos", () => {
    expect(() => calcTabulador(-1, 0)).toThrow(RangeError);
    expect(() => calcTabulador(1, -1)).toThrow(RangeError);
  });
});

describe("lineTotal", () => {
  it("multiplica precio unitario por cantidad", () => {
    expect(lineTotal("121.68", 10)).toBe("1216.80");
    expect(lineTotal("0.33", 3)).toBe("0.99");
  });
});
