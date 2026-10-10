import { describe, expect, it } from "vitest";
import { defaultMinUnit, describeMin, effectiveMin, minAlert, minCondition, pdfQuantity } from "@/lib/quotes/min-purchase";

const q = (o: Partial<{ c: number | string | null; u: string | null; m: number | string | null }> = {}) => ({
  moneda: "MXN" as const,
  compra_min_cantidad: o.c ?? null,
  compra_min_unidad: o.u ?? null,
  compra_min_monto: o.m ?? null,
});

describe("compra minima", () => {
  it("cotizaciones anteriores sin cantidad se asumen con minimo 1 en la unidad de la partida", () => {
    expect(effectiveMin(q(), "caja")).toEqual({ cantidad: 1, unidad: "caja", monto: null });
    expect(effectiveMin(q(), null).unidad).toBe("pieza");
    expect(describeMin(q(), "caja")).toBe("1 caja");
    expect(minCondition(q(), "caja")).toBeNull();
  });
  it("monto minimo heredado se conserva como condicion adicional", () => {
    expect(describeMin(q({ m: 1500 }), "kg")).toBe("1 kg / $1,500.00 MXN");
    expect(minCondition(q({ m: 1500 }), "kg")).toBe("$1,500.00 MXN");
  });
  it("unidad por defecto: la de la partida si es conocida", () => {
    expect(defaultMinUnit("caja")).toBe("caja");
    expect(defaultMinUnit("cosa rara")).toBe("pieza");
    expect(defaultMinUnit(null)).toBe("pieza");
  });
  it("alerta solo si pedida < minimo y misma unidad", () => {
    const a = minAlert({ cantidad: 5, unidad: "caja" }, q({ c: 10, u: "caja" }));
    expect(a?.text).toBe("Cantidad pedida (5 caja) menor al mínimo (10 caja)");
    expect(minAlert({ cantidad: 10, unidad: "caja" }, q({ c: 10, u: "caja" }))).toBeNull();
    expect(minAlert({ cantidad: 5, unidad: "pieza" }, q({ c: 10, u: "caja" }))).toBeNull();
    expect(minAlert({ cantidad: null, unidad: null }, q({ c: 10, u: "caja" }))).toBeNull(); // solo talla
    expect(minAlert({ cantidad: 1, unidad: "pieza" }, q())).toBeNull();
  });
  it("cantidad del PDF segun la decision", () => {
    const item = { cantidad: 5, unidad: "caja" };
    const quote = q({ c: 10, u: "caja" });
    expect(pdfQuantity(item, quote, "cotizar_minimo")).toBe(10);
    expect(pdfQuantity(item, quote, "mantener_pedida")).toBe(5);
    expect(pdfQuantity({ cantidad: 20, unidad: "caja" }, quote, "cotizar_minimo")).toBe(20);
  });
});
