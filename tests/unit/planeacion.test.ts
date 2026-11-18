import { describe, expect, it } from "vitest";
import {
  calcular,
  fechaDeFolio,
  folioOc,
  historialConPortal,
  llegadaEfectiva,
  redondeaEmpaque,
  rellenarContenedor,
  ventaReal,
  type ArticuloPlan,
  type MesHist,
  type PlanProveedor,
} from "@/lib/planeacion";

const china: PlanProveedor = { id: "p1", nombre: "TSINGAO", codigo: "JGH", origen: "china", entrega_dias: 120, recibe_parcial: false, tope_usd: null, contenedor_cbm: 2, base_meses: 2, objetivo_meses: 3, punto_meses: 6, cobertura_meses: 9 };
const usa: PlanProveedor = { ...china, id: "p2", nombre: "topglove", codigo: "TGU", origen: "usa", entrega_dias: 30, recibe_parcial: true, tope_usd: 30000, contenedor_cbm: null };
const mes = (m: string, venta: number, dias_stock: number, dias = 30): MesHist => ({ mes: m, venta, traspasos: 0, dias_stock, dias, existencia_fin: 0 });
const art = (o: Partial<ArticuloPlan> = {}): ArticuloPlan => ({
  clave: "A",
  nombre: "Articulo",
  um: "PIEZA",
  empaque: null,
  cbm_empaque: null,
  precio: 10,
  existencia_corte: 0,
  ventas_portal: 0,
  recibido_post: 0,
  existencia: 0,
  historial: [],
  llegadas: [],
  ...o,
});
const P = { ventana: 12, crecimiento: 0, traspasos: true };

describe("planeacion de compras", () => {
  it("la venta real divide solo entre los dias con existencia", () => {
    // 6 meses: vendio 100 en un mes con stock y nada en 5 meses sin stock
    const h = [mes("2026-01", 100, 30), ...["02", "03", "04", "05", "06"].map((m) => mes(`2026-${m}`, 0, 0))];
    const v = ventaReal(h, P);
    expect(v.simple).toBeCloseTo((100 / 180) * 30.4, 5);
    expect(v.real).toBeCloseTo((100 / 30) * 30.4, 5);
    expect(v.sinStock).toBeCloseTo(5 / 6, 5);
  });

  it("tambien cuenta como desabasto los dias con menos de un pedido normal", () => {
    // Nunca llego a cero, pero 20 de 30 dias tuvo menos de un pedido normal: en los 10 dias buenos vendio 300.
    const h: MesHist[] = [{ mes: "2026-10", venta: 330, traspasos: 0, dias_stock: 30, dias: 30, existencia_fin: 10, dias_suf: 10, venta_suf: 300, tras_suf: 0 }];
    const v = ventaReal(h, P);
    expect(v.simple).toBeCloseTo((330 / 30) * 30.4, 5);
    expect(v.real).toBeCloseTo(v.simple, 5); // con menos de 20 dias buenos no se usa
    const h2 = [h[0], { ...h[0], mes: "2026-09" }];
    const v2 = ventaReal(h2, P);
    expect(v2.real).toBeCloseTo((600 / 20) * 30.4, 5);
    expect(v2.sinStock).toBe(0);
    expect(v2.bajoStock).toBeCloseTo(40 / 60, 5);
    // Nunca baja del calculo por dias en cero
    const h3 = [{ ...h[0], dias_suf: 25, venta_suf: 10 }, { ...h[0], mes: "2026-09", dias_suf: 25, venta_suf: 10 }];
    expect(ventaReal(h3, P).real).toBeCloseTo((660 / 60) * 30.4, 5);
  });

  it("redondea a cajas completas", () => {
    expect(redondeaEmpaque(55, 54)).toBe(108);
    expect(redondeaEmpaque(54, 54)).toBe(54);
    expect(redondeaEmpaque(0, 54)).toBe(0);
    expect(redondeaEmpaque(3.2, null)).toBe(4);
  });

  it("China: pide al bajar del punto y rellena hasta la cobertura, en cajas", () => {
    const h = Array.from({ length: 12 }, (_, i) => mes(`2025-${String(i + 1).padStart(2, "0")}`, 100, 30, 30));
    // venta real = 100/30*30.4 = 101.33/mes; punto 6 meses = 608; cobertura 9 = 912
    const a = art({ existencia: 300, historial: h, empaque: 50, cbm_empaque: 0.1 });
    const c = calcular(a, china, P, "2026-11-18");
    expect(c.reorden).toBeCloseTo(608, 0);
    expect(c.sugerido).toBe(650); // 912 - 300 = 612 -> 13 cajas de 50
    expect(c.cbm).toBeCloseTo(1.3, 5);
    expect(c.semaforo).toBe("rojo"); // con 3 meses de inventario se acaba antes de que llegue (4 meses)
    // Con lo que viene en camino ya no pide
    const b = art({ ...a, llegadas: [{ folio: "26JGH1104", oc_id: "x", estado: "enviada", cantidad: 700, fecha: "2026-12-01" }] });
    const cb = calcular(b, china, P, "2026-11-18");
    expect(cb.sugerido).toBe(0);
    expect(cb.semaforo).toBe("verde");
  });

  it("USA: entrega + base para pedir, entrega + objetivo para la cantidad", () => {
    const h = Array.from({ length: 12 }, (_, i) => mes(`2025-${String(i + 1).padStart(2, "0")}`, 30.4, 30.4));
    const a = art({ existencia: 50, historial: h });
    const c = calcular(a, usa, { ...P, crecimiento: 0.16 }, "2026-11-18");
    const plan = 30.4 * 1.16;
    const lead = 30 / 30.4;
    expect(c.plan).toBeCloseTo(plan, 5);
    expect(c.reorden).toBeCloseTo(plan * (lead + 2), 5);
    expect(c.sugerido).toBe(Math.ceil(plan * (lead + 3) - 50));
  });

  it("una llegada atrasada se supone en 15 dias", () => {
    expect(llegadaEfectiva("2026-10-01", "2026-11-18")).toBe("2026-12-03");
    expect(llegadaEfectiva("2027-01-10", "2026-11-18")).toBe("2027-01-10");
  });

  it("folio: ano + siglas + mes + dia, con -2 si ya existe", () => {
    expect(folioOc("JGH", "2026-11-04")).toBe("26JGH1104");
    expect(folioOc("JGH", "2026-11-04", ["26JGH1104"])).toBe("26JGH1104-2");
    expect(fechaDeFolio("PO 26JGH0629")).toBe("2026-06-29");
    expect(fechaDeFolio("26GLI0930")).toBe("2026-09-30");
  });

  it("las ventas del portal despues del corte entran al historial", () => {
    const h = [mes("2026-11", 10, 18, 18)];
    const r = historialConPortal(h, "2026-11-18", "2026-12-02", [{ fecha: "2026-11-18", cantidad: 99 }, { fecha: "2026-11-20", cantidad: 5 }, { fecha: "2026-12-01", cantidad: 7 }], true);
    expect(r.map((m) => m.mes)).toEqual(["2026-11", "2026-12"]);
    expect(r[0].venta).toBe(15); // la del dia del corte ya venia en el kardex
    expect(r[0].dias).toBe(30);
    expect(r[1]).toMatchObject({ venta: 7, dias: 2, dias_stock: 2 });
  });

  it("llenar contenedor reparte cajas a lo que se acaba primero sin pasarse", () => {
    const h = Array.from({ length: 12 }, (_, i) => mes(`2025-${String(i + 1).padStart(2, "0")}`, 100, 30));
    const a1 = art({ clave: "A1", existencia: 2000, historial: h, empaque: 10, cbm_empaque: 0.1 });
    const a2 = art({ clave: "A2", existencia: 100, historial: h, empaque: 10, cbm_empaque: 0.1 });
    const prov = { ...china, contenedor_cbm: 10 };
    const extra = rellenarContenedor([a1, a2], prov, P, "2026-11-18");
    const base = [a1, a2].reduce((s, a) => s + calcular(a, china, P, "2026-11-18").cbm, 0);
    const total = base + ((extra.A1 ?? 0) + (extra.A2 ?? 0)) / 10 * 0.1;
    expect(base).toBeLessThan(10);
    expect(total).toBeLessThanOrEqual(10 + 1e-9);
    expect(total).toBeGreaterThan(10 - 0.1 - 1e-9);
    expect((extra.A2 ?? 0)).toBeGreaterThan(extra.A1 ?? 0);
  });
});
