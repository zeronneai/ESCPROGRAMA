import { describe, expect, it } from "vitest";
import { calcular, type ArticuloPlan, type PlanProveedor } from "@/lib/planeacion";
import { claveDeArticulo, recuentoPorArticulo } from "@/lib/pegatron-recuento";

describe("Pegatron: recuento por articulo", () => {
  it("saca la clave ESC del texto", () => {
    expect(claveDeArticulo("ESC-TMCP1-00575 · Cinta de papel")).toBe("ESC-TMCP1-00575");
    expect(claveDeArticulo("cinta esc-tmcp1-00575")).toBe("ESC-TMCP1-00575");
    expect(claveDeArticulo("MSR-65P membrana")).toBe("MSR-65P");
    expect(claveDeArticulo("Rollo wiper cuarto limpio")).toBeNull();
  });

  it("suma lo pendiente por articulo entre ordenes; lo ya pedido no cuenta", () => {
    const base = { unidad: "RL", entrega: null, pedido_at: null };
    const r = recuentoPorArticulo([
      { ...base, id: "1", articulo_esc: "ESC-TMCP1-00575 · Cinta", cantidad: 100, po: "A", oc_id: "a", entrega: "2026-12-10" },
      { ...base, id: "2", articulo_esc: "esc-tmcp1-00575", cantidad: "50", po: "B", oc_id: "b", entrega: "2026-12-01" },
      { ...base, id: "3", articulo_esc: "Rollo wiper  cuarto limpio", cantidad: 5, po: "B", oc_id: "b" },
      { ...base, id: "4", articulo_esc: "rollo WIPER cuarto limpio", cantidad: 7, unidad: "pz", po: "C", oc_id: "c" },
      { ...base, id: "5", articulo_esc: "ESC-TMCP1-00575", cantidad: 999, po: "C", oc_id: "c", pedido_at: "2026-11-01" },
    ]);
    expect(r).toHaveLength(2);
    const cinta = r.find((f) => f.clave === "ESC-TMCP1-00575")!;
    expect(cinta.cantidades).toEqual([{ unidad: "RL", total: 150 }]);
    expect(cinta.ocs.map((o) => o.po)).toEqual(["A", "B"]);
    expect(cinta.entrega).toBe("2026-12-01");
    expect(cinta.lineas).toEqual(["1", "2"]);
    const wiper = r.find((f) => !f.clave)!;
    expect(wiper.cantidades).toEqual([{ unidad: "RL", total: 5 }, { unidad: "PZ", total: 7 }]);
  });

  it("en planeacion lo de Pegatron por pedir baja la posicion y sube lo sugerido", () => {
    const prov: PlanProveedor = { id: "p", nombre: "TSINGAO", codigo: "JGH", origen: "china", entrega_dias: 120, recibe_parcial: false, tope_usd: null, contenedor_cbm: null, base_meses: 2, objetivo_meses: 3, punto_meses: 6, cobertura_meses: 9 };
    const h = Array.from({ length: 12 }, (_, i) => ({ mes: `2025-${String(i + 1).padStart(2, "0")}`, venta: 100, traspasos: 0, dias_stock: 30, dias: 30, existencia_fin: 0 }));
    const a: ArticuloPlan = { clave: "A", nombre: "A", um: null, empaque: null, cbm_empaque: null, precio: 1, existencia_corte: 600, ventas_portal: 0, recibido_post: 0, existencia: 600, historial: h, llegadas: [] };
    const P = { ventana: 12, crecimiento: 0, traspasos: true };
    const sin = calcular(a, prov, P, "2026-11-18");
    const con = calcular({ ...a, pegatron: { cantidad: 300, pos: ["450001"] } }, prov, P, "2026-11-18");
    expect(con.posicion).toBe(sin.posicion - 300);
    expect(con.sugerido).toBeGreaterThanOrEqual(sin.sugerido + 299);
  });
});
