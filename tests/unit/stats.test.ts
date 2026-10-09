import { describe, expect, it } from "vitest";
import { computeBuyerStats, normalizeReason, type StatRow } from "@/lib/stats/buyer-stats";
import { summarizeSeller, viewState } from "@/lib/stats/seller-summary";
import { auditActionLabel, buildTimeline } from "@/lib/stats/timeline";

let n = 0;
const row = (o: Partial<StatRow> = {}): StatRow => ({
  requestId: "r1", requestFolio: "COT-2026-0001", submittedAt: "2026-03-02T15:00:00Z", dueAt: "2026-03-04T15:00:00Z",
  vendedorId: "v1", vendedorNombre: "Ana", customerId: "c1", customerNombre: "Cliente A", itemId: `i${n++}`,
  estado: "pendiente", firstResponseAt: null, responseHours: null, notFoundNote: null, moneda: null, precioElegido: null, ...o,
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
    expect(c).toEqual({ solicitudes: 2, pendientes: 1, vencidas: 1, respondidas: 3, noEncontradas: 1, enviadas: 1, sinEnviar: 1 });
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
  it("etiquetas de bitacora", () => {
    expect(auditActionLabel("copy_price_table")).toBe("copio la tabla de precios");
    expect(auditActionLabel("otra")).toBe("otra");
  });
});
