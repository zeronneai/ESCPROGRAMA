import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { computeDeadlineNotices, computeSinResultado, type DispatchedItem } from "@/lib/quotes/deadlines";

const TZ = "America/Chihuahua";
const cfg = { timezone: TZ, holidays: [] as string[], warnHours: 12 };
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const due = (iso: string) => at(iso).toISOString();

describe("computeDeadlineNotices", () => {
  const now = at("2026-03-03T09:00"); // martes
  it("por vencer cuando quedan 12 horas habiles o menos", () => {
    const n = computeDeadlineNotices([{ id: "a", folio: "F1", due_at: due("2026-03-03T21:00") }], now, cfg);
    expect(n).toMatchObject([{ requestId: "a", kind: "por_vencer" }]);
  });
  it("sin aviso si queda mas tiempo", () => {
    expect(computeDeadlineNotices([{ id: "a", folio: "F1", due_at: due("2026-03-04T09:00") }], now, cfg)).toEqual([]);
  });
  it("vencida cuando el plazo ya paso", () => {
    const n = computeDeadlineNotices([{ id: "a", folio: "F1", due_at: due("2026-03-03T08:00") }], now, cfg);
    expect(n[0].kind).toBe("vencida");
  });
  it("el fin de semana no cuenta: viernes 20:00 con vencimiento lunes 08:00 sigue por vencer", () => {
    const n = computeDeadlineNotices([{ id: "a", folio: "F1", due_at: due("2026-03-09T08:00") }], at("2026-03-06T20:00"), cfg);
    expect(n[0].kind).toBe("por_vencer");
    expect(n[0].remaining).toBeCloseTo(12, 5);
  });
});

describe("computeSinResultado (aviso al vendedor)", () => {
  const now = new Date("2026-03-31T12:00:00Z");
  const base: DispatchedItem = { itemId: "i", requestId: "r", folio: "F", producto: "P", vendedorId: "v", enviadoAt: "2026-03-10T12:00:00Z", resultado: "sin_respuesta" };
  it("avisa solo si pasaron mas de 15 dias y sigue sin resultado", () => {
    expect(computeSinResultado([base], now)).toHaveLength(1);
    expect(computeSinResultado([{ ...base, enviadoAt: "2026-03-20T12:00:00Z" }], now)).toHaveLength(0);
    expect(computeSinResultado([{ ...base, resultado: "ganada" }], now)).toHaveLength(0);
    expect(computeSinResultado([{ ...base, resultado: "perdida" }], now)).toHaveLength(0);
  });
  it("el limite es exactamente 15 dias", () => {
    expect(computeSinResultado([{ ...base, enviadoAt: "2026-03-16T12:00:00Z" }], now)).toHaveLength(0); // justo 15 dias
    expect(computeSinResultado([{ ...base, enviadoAt: "2026-03-16T11:59:00Z" }], now)).toHaveLength(1);
  });
});
