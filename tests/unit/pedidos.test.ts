import { describe, expect, it } from "vitest";
import { ejecutar, type Propuesta } from "@/lib/asistente-compras";
import { mensualDe, resumenPedidos, type PedidoPlan } from "@/lib/pedidos";
import { calcular, type ArticuloPlan, type PlanProveedor } from "@/lib/planeacion";
import type { DatosPlaneacion } from "@/lib/planeacion-server";

const usa: PlanProveedor = { id: "p2", nombre: "TopGlove", codigo: "TGU", origen: "usa", entrega_dias: 30, recibe_parcial: true, tope_usd: 1000, contenedor_cbm: null, base_meses: 2, objetivo_meses: 3, punto_meses: 6, cobertura_meses: 9 };
const art = (o: Partial<ArticuloPlan & { proveedor_id: string }> = {}): ArticuloPlan & { proveedor_id: string } => ({
  clave: "A", nombre: "Guante", um: "CAJA", empaque: 10, cbm_empaque: null, precio: 5, existencia_corte: 0, ventas_portal: 0, recibido_post: 0, existencia: 0, historial: [], llegadas: [], proveedor_id: "p2", ...o,
});
const ped = (frecuencia: PedidoPlan["frecuencia"], cantidad: number): PedidoPlan => ({ id: frecuencia, vendedor: "Ana", cantidad, frecuencia, cliente: null, notas: null, created_at: "2026-11-01" });
const P = { ventana: 12, crecimiento: 0, traspasos: true };

describe("pedidos de vendedores", () => {
  it("convierte la frecuencia a demanda mensual; unica no suma", () => {
    expect(mensualDe("semanal", 12)).toBeCloseTo(52);
    expect(mensualDe("mensual", 7)).toBe(7);
    expect(mensualDe("anual", 120)).toBe(10);
    expect(mensualDe("unica", 50)).toBe(0);
    expect(resumenPedidos([ped("unica", 30), ped("mensual", 5), ped("anual", 24)])).toEqual({ unica: 30, mensual: 7 });
  });

  it("un pedido especial sin venta se pide (redondeado a cajas) y los recurrentes suben la demanda", () => {
    const a = art({ existencia: 5, pedidos: { unica: 23, mensual: 0, lista: [ped("unica", 23)] } });
    const c = calcular(a, usa, P, "2026-11-25");
    expect(c.sugerido).toBe(20); // falta 18 -> 2 cajas de 10
    expect(c.semaforo).toBe("amarillo");
    const b = art({ existencia: 0, pedidos: { unica: 0, mensual: 10, lista: [ped("mensual", 10)] } });
    const cb = calcular(b, usa, P, "2026-11-25");
    expect(cb.plan).toBe(10);
    expect(cb.extraVend).toBe(10);
    expect(calcular(b, usa, { ...P, pedidos: false }, "2026-11-25").plan).toBe(0);
  });

  it("la propuesta del asistente redondea a cajas, quita claves de otro proveedor y avisa del tope", async () => {
    const datos = {
      corte: "2026-10-31", hoy: "2026-11-25", proveedores: [usa, { ...usa, id: "p3", nombre: "Otro", codigo: "OTR" }],
      articulos: [art(), art({ clave: "B", proveedor_id: "p3" })], ocs: [], ventasPortal: 0, pedidosOtros: [],
    } as unknown as DatosPlaneacion;
    const ctx = { datos, supabase: null as never, propuesta: null as Propuesta | null, reglas: "" };
    const r = (await ejecutar("proponer_ocs", { resumen: "x", ocs: [{ proveedor: "topglove", fecha: "2026-11-25", lineas: [{ clave: "a", cantidad: 205 }, { clave: "B", cantidad: 10 }] }] }, ctx)) as { avisos: string[] };
    expect(ctx.propuesta!.ocs[0].lineas).toEqual([expect.objectContaining({ clave: "A", cantidad: 210, importe: 1050 })]);
    expect(r.avisos.join(" ")).toMatch(/B es de otro proveedor/);
    expect(r.avisos.join(" ")).toMatch(/pasa el tope/);
  });
});
