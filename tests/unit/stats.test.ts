import { describe, expect, it } from "vitest";
import { computeBuyerStats, normalizeReason, type StatRow } from "@/lib/stats/buyer-stats";
import { summarizeSeller, viewState } from "@/lib/stats/seller-summary";
import { auditActionLabel, buildTimeline } from "@/lib/stats/timeline";

let n = 0;
const row = (o: Partial<StatRow> = {}): StatRow => ({
  requestId: "r1", requestFolio: "COT-2026-0001", submittedAt: "2026-03-02T15:00:00Z", dueAt: "2026-03-04T15:00:00Z",
  vendedorId: "v1", vendedorNombre: "Ana", customerId: "c1", customerNombre: "Cliente A", itemId: `i${n++}`,
  estado: "pendiente", firstResponseAt: null, responseHours: null, notFoundNote: null, moneda: null, precioElegido: null,
  cantidad: null, valorUnitario: null, outcome: null, outcomeMotivo: null, cantidadFinal: null, updates: [], ...o,
});

describe("computeBuyerStats", () => {
  it("sin datos no divide entre cero", () => {
    const s = computeBuyerStats([]);
    expect(s.tasaRespuesta).toBeNull();
    expect(s.promedioHoras).toBeNull();
    expect(s.tendenciaSemanal).toEqual([]);
  });

  const rows = [
    row({ estado: "enviada_cliente", firstResponseAt: "2026-03-03T10:00:00Z", responseHours: 10, moneda: "MXN", precioElegido: 3 }),
    row({ estado: "cotizada", firstResponseAt: "2026-03-05T10:00:00Z", responseHours: 40, moneda: "MXN" }), // fuera de plazo
    row({ estado: "no_encontrada", firstResponseAt: "2026-03-03T12:00:00Z", responseHours: 4, notFoundNote: "Sin proveedor. " }),
    row({ estado: "no_encontrada", firstResponseAt: "2026-03-03T12:00:00Z", responseHours: 6, notFoundNote: "sin   proveedor" }),
    row({ estado: "pendiente", vendedorId: "v2", vendedorNombre: "Luis", customerNombre: "Cliente B", submittedAt: "2026-04-14T15:00:00Z", dueAt: "2026-04-16T15:00:00Z" }),
  ];
  const s = computeBuyerStats(rows);

  it("tasas basicas", () => {
    expect(s).toMatchObject({ totalPartidas: 5, solicitudes: 1, respondidas: 4, cotizadas: 2, noEncontradas: 2, enviadas: 1 });
    expect(s.tasaRespuesta).toBeCloseTo(0.8);
    expect(s.dentroDePlazo).toBeCloseTo(0.75);
    expect(s.promedioHoras).toBeCloseTo(15);
    expect(s.tasaNoEncontrada).toBeCloseTo(0.5);
    expect(s.pctEnviado).toBeCloseTo(0.5);
  });
  it("razones agrupadas sin importar mayusculas ni espacios", () => {
    expect(s.razones).toEqual([{ label: "sin proveedor", count: 2 }]);
    expect(normalizeReason("  Sin   Stock. ")).toBe("sin stock");
  });
  it("distribucion de precio elegido siempre trae los 5", () => {
    expect(s.distribucionPrecio.map((x) => x.count)).toEqual([0, 0, 1, 0, 0]);
  });
  it("por vendedor, cliente y mes cuentan solo cotizadas", () => {
    expect(s.porVendedor).toEqual([{ label: "Ana", count: 2 }]);
    expect(s.porCliente).toEqual([{ label: "Cliente A", count: 2 }]);
    expect(s.porMes).toEqual([{ label: "2026-03", count: 2 }]);
  });
  it("tendencia semanal por lunes de la semana de envio", () => {
    expect(s.tendenciaSemanal).toEqual([
      { semana: "2026-03-02", enviadas: 4, respondidas: 4 },
      { semana: "2026-04-13", enviadas: 1, respondidas: 0 },
    ]);
  });
});

describe("seller summary", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  it("viewState marca vencida solo si esta pendiente y paso el plazo", () => {
    expect(viewState("pendiente", "2026-03-10T11:00:00Z", now)).toBe("vencida");
    expect(viewState("pendiente", "2026-03-10T13:00:00Z", now)).toBe("pendiente");
    expect(viewState("cotizada", "2026-03-01T00:00:00Z", now)).toBe("cotizada");
  });
  it("cuenta actualizaciones solicitadas y aclaraciones pendientes", () => {
    const c = summarizeSeller(
      [
        { requestId: "a", estado: "actualizacion_solicitada", dueAt: "2026-03-09T00:00:00Z" },
        { requestId: "a", estado: "esperando_aclaracion", dueAt: "2026-03-09T00:00:00Z" },
      ],
      now,
    );
    expect(c).toMatchObject({ actualizaciones: 1, aclaraciones: 1, pendientes: 0, vencidas: 0 });
  });
  it("contadores", () => {
    const c = summarizeSeller(
      [
        { requestId: "a", estado: "pendiente", dueAt: "2026-03-11T00:00:00Z" },
        { requestId: "a", estado: "pendiente", dueAt: "2026-03-09T00:00:00Z" },
        { requestId: "b", estado: "cotizada", dueAt: "2026-03-09T00:00:00Z" },
        { requestId: "b", estado: "no_encontrada", dueAt: "2026-03-09T00:00:00Z" },
        { requestId: "b", estado: "enviada_cliente", dueAt: "2026-03-09T00:00:00Z" },
      ],
      now,
    );
    expect(c).toEqual({ solicitudes: 2, pendientes: 1, vencidas: 1, respondidas: 3, noEncontradas: 1, enviadas: 1, sinEnviar: 1, actualizaciones: 0, aclaraciones: 0 });
  });
});

describe("buildTimeline", () => {
  it("ordena eventos y no incluye costos", () => {
    const t = buildTimeline(
      { folio: "COT-1", created_at: "2026-03-01T10:00:00Z", submitted_at: "2026-03-02T10:00:00Z", due_at: null },
      [
        {
          folio: "COT-1-01", producto: "Guante", estado: "enviada_cliente", not_found_note: "sin proveedor",
          first_response_at: "2026-03-03T09:00:00Z",
          item_quotes: [{ version: 1, quoted_at: "2026-03-04T09:00:00Z" } as never],
          item_dispatch: [{ precio_elegido: 3, enviado_at: "2026-03-05T09:00:00Z" } as never],
        },
      ],
    );
    expect(t.map((e) => e.text)).toEqual([
      "Borrador creado",
      "Solicitud COT-1 enviada al comprador",
      "COT-1-01 Guante: marcada como no encontrada (sin proveedor)",
      "COT-1-01 Guante: cotizada",
      "COT-1-01 Guante: enviada al cliente con el Precio 3",
    ]);
  });
  it("incluye actualizaciones, aclaraciones y resultados", () => {
    const t = buildTimeline(
      { folio: "COT-1", created_at: null, submitted_at: "2026-03-02T10:00:00Z", due_at: null },
      [
        {
          folio: "COT-1-01", producto: "Guante", estado: "cotizada", not_found_note: null, first_response_at: "2026-03-03T09:00:00Z",
          item_quotes: [
            { version: 1, quoted_at: "2026-03-03T09:00:00Z" } as never,
            { version: 2, quoted_at: "2026-03-25T09:00:00Z" } as never,
          ],
          item_dispatch: [],
          item_update_requests: [{ requested_at: "2026-03-24T09:00:00Z", nota: "Cliente pide precio", resolved_at: "2026-03-25T09:00:00Z", resolution: "sin_cambios", resolved_version: 2 } as never],
          item_clarification_pauses: [{ clarification_requested_at: "2026-03-03T10:00:00Z", resumed_at: "2026-03-03T12:00:00Z" } as never],
          item_outcomes: [{ resultado: "ganada", updated_at: "2026-03-26T09:00:00Z" } as never],
        },
      ],
    ).map((e) => e.text);
    expect(t).toContain("COT-1-01 Guante: actualizacion solicitada (Cliente pide precio)");
    expect(t).toContain("COT-1-01 Guante: actualizacion resuelta sin cambios (version 2)");
    expect(t).toContain("COT-1-01 Guante: cotizada (version 2, COT-1-01-R2)");
    expect(t).toContain("COT-1-01 Guante: aclaracion solicitada (reloj en pausa)");
    expect(t).toContain("COT-1-01 Guante: aclaracion respondida (reloj reanudado)");
    expect(t).toContain("COT-1-01 Guante: resultado ganada");
  });
  it("etiquetas de bitacora", () => {
    expect(auditActionLabel("copy_price_table")).toBe("copio la tabla de precios");
    expect(auditActionLabel("otra")).toBe("otra");
  });
});

describe("fase 4: conversion, valor y actualizaciones", () => {
  const sent = (o: Partial<StatRow>) => row({ estado: "enviada_cliente", firstResponseAt: "2026-03-03T10:00:00Z", moneda: "MXN", ...o });
  const rows = [
    sent({ outcome: "ganada", precioElegido: 3, cantidad: 10, valorUnitario: 100, cantidadFinal: 8 }),
    sent({ outcome: "ganada", precioElegido: 3, cantidad: 2, valorUnitario: 50 }),
    sent({ outcome: "perdida", outcomeMotivo: "precio_alto", precioElegido: 1, cantidad: 5, valorUnitario: 40 }),
    sent({ outcome: "perdida", outcomeMotivo: "precio_alto", precioElegido: 1, vendedorNombre: "Luis", customerNombre: "Cliente B", cantidad: 1, valorUnitario: 10 }),
    sent({ outcome: "perdida", outcomeMotivo: "tiempo_entrega", precioElegido: 5, vendedorNombre: "Luis", cantidad: 1, valorUnitario: 10 }),
    sent({ outcome: "sin_respuesta", precioElegido: 2, cantidad: 1, valorUnitario: 1000 }),
    sent({ outcome: "ganada", moneda: "USD", precioElegido: 4, cantidad: 3, valorUnitario: 20, submittedAt: "2026-04-14T15:00:00Z" }),
    row({ estado: "cotizada", firstResponseAt: "2026-03-03T10:00:00Z", moneda: "MXN" }), // no enviada: no cuenta
  ];
  const s = computeBuyerStats(rows);

  it("tasa de conversion = ganadas entre enviadas CON resultado (sin respuesta no cuenta)", () => {
    expect(s.conversionGlobal).toMatchObject({ enviadas: 7, ganadas: 3, perdidas: 3 });
    expect(s.conversionGlobal.tasa).toBeCloseTo(0.5);
  });
  it("por vendedor, cliente, mes y precio elegido", () => {
    const ana = s.conversionPorVendedor.find((c) => c.label === "Ana")!;
    expect(ana).toMatchObject({ ganadas: 3, perdidas: 1 });
    expect(ana.tasa).toBeCloseTo(0.75);
    expect(s.conversionPorVendedor.find((c) => c.label === "Luis")!.tasa).toBe(0);
    expect(s.conversionPorCliente.find((c) => c.label === "Cliente B")).toMatchObject({ ganadas: 0, perdidas: 1 });
    expect(s.conversionPorMes.map((c) => c.label)).toEqual(["2026-03", "2026-04"]);
    expect(s.conversionPorMes[1].tasa).toBe(1);
    expect(s.conversionPorPrecio.map((c) => c.tasa)).toEqual([0, null, 1, 1, 0]);
  });
  it("motivos de perdida mas frecuentes", () => {
    expect(s.motivosPerdida).toEqual([{ label: "precio_alto", count: 2 }, { label: "tiempo_entrega", count: 1 }]);
  });
  it("valor cotizado contra valor ganado por moneda (cantidad final si existe)", () => {
    const mxn = s.valorPorMoneda.find((v) => v.moneda === "MXN")!;
    expect(mxn.cotizado).toBe(10 * 100 + 2 * 50 + 5 * 40 + 10 + 10 + 1000);
    expect(mxn.ganado).toBe(8 * 100 + 2 * 50);
    expect(s.valorPorMoneda.find((v) => v.moneda === "USD")).toEqual({ moneda: "USD", cotizado: 60, ganado: 60 });
  });
  it("actualizaciones solicitadas y tiempo de respuesta a ellas", () => {
    const r = computeBuyerStats([
      sent({ updates: [{ requestedAt: "2026-03-10T10:00:00Z", resolvedAt: "2026-03-11T10:00:00Z", hours: 10 }, { requestedAt: "2026-03-12T10:00:00Z", resolvedAt: null, hours: null }] }),
      sent({ updates: [{ requestedAt: "2026-03-10T10:00:00Z", resolvedAt: "2026-03-11T10:00:00Z", hours: 20 }] }),
    ]);
    expect(r.actualizaciones).toEqual({ solicitadas: 3, resueltas: 2, promedioHoras: 15 });
  });
  it("sin resultados no inventa porcentajes", () => {
    const r = computeBuyerStats([sent({ outcome: "sin_respuesta" })]);
    expect(r.conversionGlobal.tasa).toBeNull();
    expect(r.valorPorMoneda).toEqual([]);
  });
});
