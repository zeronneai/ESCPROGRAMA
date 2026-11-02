import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { currentStage, eventText, prospectGroup, salesGroup, stageState, type BitacoraRow } from "@/lib/bitacora/stages";
import { periodRange, summarizeSellers, totals, type SummaryBitacora, type SummaryVenta } from "@/lib/stats/sales-summary";
import { cobroEstado, diasVencidos, saldo } from "@/lib/ventas";

const row = (o: Partial<BitacoraRow> = {}): BitacoraRow => ({
  id: "b1", vendedor_id: "v1", customer_id: "c1", request_id: null, necesidad: null, fecha_catalogo: null, fecha_muestra: null,
  muestra_no_aplica: false, fecha_solicitud_compras: null, fecha_cotizacion: null, fecha_pedido: null, facturacion: null,
  fecha_factura: null, monto_venta: null, moneda: "MXN", porcentaje_cobranza: null, fecha_entrega: null, cartera_dias_vencidos: null,
  cartera_monto: null, comentarios: null, proximo_seguimiento: null, resultado: "abierta", motivo_perdida: null, origen: "vendedor",
  archived_at: null, created_at: "2026-10-01T15:00:00Z", updated_at: "2026-10-01T15:00:00Z", ...o,
});

describe("etapas de la bitacora (ESC-VEN-FR-002)", () => {
  it("sin datos: sin iniciar y primer contacto", () => {
    expect(currentStage(row()).stage).toBeNull();
    expect(prospectGroup(row())).toBe("contacto");
    expect(salesGroup(row())).toBe("cotizando");
  });
  it("la etapa actual es la mas avanzada; las saltadas quedan pendientes y la muestra puede no aplicar", () => {
    const r = row({ fecha_catalogo: "2026-10-01", fecha_cotizacion: "2026-10-03", muestra_no_aplica: true });
    expect(currentStage(r).stage?.key).toBe("cotizacion");
    expect(stageState(r, 1)).toBe("pending"); // necesidad
    expect(stageState(r, 2)).toBe("na"); // muestra
    expect(stageState(r, 5)).toBe("future");
    expect(prospectGroup(r)).toBe("cotizando");
  });
  it("ventas: pedido, facturado, entregado y cobrado (100%)", () => {
    expect(salesGroup(row({ fecha_pedido: "2026-10-05" }))).toBe("pedido");
    expect(salesGroup(row({ fecha_pedido: "2026-10-05", facturacion: "credito" }))).toBe("facturado");
    expect(salesGroup(row({ fecha_entrega: "2026-10-09" }))).toBe("entregado");
    expect(salesGroup(row({ porcentaje_cobranza: "50" }))).toBe("cotizando");
    expect(salesGroup(row({ porcentaje_cobranza: "100.00" }))).toBe("cobrado");
    expect(prospectGroup(row({ fecha_pedido: "2026-10-05" }))).toBe("pedido");
  });
  it("texto de los movimientos", () => {
    expect(eventText({ tipo: "alta", etapa: null, nota: "portal" })).toMatch(/portal/);
    expect(eventText({ tipo: "etapa", etapa: "fecha_pedido", nota: "2026-10-05" })).toBe("Orden de compra / pedido: 5 oct 2026");
    expect(eventText({ tipo: "comentario", etapa: null, nota: "Llamé, pide muestra" })).toBe("Llamé, pide muestra");
  });
});

describe("resumen por vendedor (jefa de ventas)", () => {
  const b = (o: Partial<SummaryBitacora>): SummaryBitacora => ({ ...row(), ...o }) as SummaryBitacora;
  const v = (o: Partial<SummaryVenta>): SummaryVenta => ({
    vendedor_id: "v1", fecha: "2026-10-06", monto: "1000", moneda: "MXN", pago: "contado", vence: null, porcentaje_cobrado: "0",
    cancelada_at: null, request_id: null, created_at: "2026-10-06T15:00:00Z", ...o,
  });
  const rows = summarizeSellers({
    sellers: [{ id: "v1", nombre: "Ana", activo: true }, { id: "v2", nombre: "Beto", activo: true }],
    requests: [{ vendedor_id: "v1", submitted_at: "2026-10-02T15:00:00Z" }, { vendedor_id: "v1", submitted_at: "2026-10-03T15:00:00Z" }],
    issues: [
      { emitida_por: "v1", request_id: "r1", emitida_at: "2026-10-04T15:00:00Z" },
      { emitida_por: "v1", request_id: "r1", emitida_at: "2026-10-05T15:00:00Z" },
      { emitida_por: "v1", request_id: "r2", emitida_at: "2026-10-05T15:00:00Z" },
    ],
    bitacora: [b({ proximo_seguimiento: "2026-10-10" }), b({ archived_at: "2026-10-02T00:00:00Z" }), b({ vendedor_id: "v2", created_at: "2026-09-01T00:00:00Z" })],
    ventas: [
      v({ request_id: "r1", monto: "1000", porcentaje_cobrado: "100" }),
      v({ fecha: "2026-09-20", monto: "999", pago: "credito", vence: "2026-10-01", porcentaje_cobrado: "50" }),
      v({ fecha: "2026-10-10", monto: "400", pago: "credito", vence: "2026-11-09" }),
      v({ monto: "5000", cancelada_at: "2026-10-07T00:00:00Z" }),
    ],
    conversions: [{ convertido_por: "v1" }],
    events: [{ created_by: "v1", created_at: "2026-10-14T15:00:00Z" }],
    fromDate: "2026-10-01",
    toDate: "2026-10-31",
    today: "2026-10-14",
  });
  it("ventas del periodo, conversion de cotizaciones, por cobrar y cartera vencida calculada", () => {
    const ana = rows.find((r) => r.id === "v1")!;
    expect(ana).toMatchObject({ solicitudes: 2, cotizacionesEnviadas: 2, ventas: 2, montoVentas: 1400, conversion: 50, porCobrar: 400 });
    expect(ana.carteraVencida).toBeCloseTo(499.5);
    expect(ana).toMatchObject({ prospectosActivos: 1, prospectosNuevos: 1, convertidos: 1, seguimientosVencidos: 1 });
    const beto = rows.find((r) => r.id === "v2")!;
    expect(beto).toMatchObject({ prospectosActivos: 1, prospectosNuevos: 0, conversion: null, ventas: 0 });
    expect(rows[0].id).toBe("v1");
    expect(totals(rows)).toMatchObject({ ventas: 2, cotizacionesEnviadas: 2, prospectosActivos: 2 });
  });
  it("periodos", () => {
    const now = DateTime.fromISO("2026-10-14T10:00:00", { zone: "America/Mexico_City" });
    expect(periodRange("mes", now).from.toISODate()).toBe("2026-10-01");
    expect(periodRange("mes_anterior", now).to.toISODate()).toBe("2026-09-30");
    expect(periodRange("7d", now).from.toISODate()).toBe("2026-10-08");
  });
});

describe("ventas diarias: cobro", () => {
  it("cartera vencida solo en credito pasado su plazo y con saldo", () => {
    const base = { monto: "1000", porcentaje_cobrado: "0", cancelada_at: null, pago: "credito" as const, vence: "2026-10-10" };
    expect(cobroEstado(base, "2026-10-14")).toBe("vencida");
    expect(diasVencidos(base, "2026-10-14")).toBe(4);
    expect(cobroEstado({ ...base, porcentaje_cobrado: "100" }, "2026-10-14")).toBe("cobrada");
    expect(cobroEstado({ ...base, pago: "contado", vence: null }, "2026-10-14")).toBe("por_cobrar");
    expect(saldo({ ...base, porcentaje_cobrado: "25" })).toBe(750);
    expect(saldo({ ...base, cancelada_at: "x" })).toBe(0);
  });
});
