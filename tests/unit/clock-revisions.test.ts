import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { effectiveDueAt, netResponseHours, pausedBusinessHours, remainingWithPauses } from "@/lib/quotes/clock";
import { isVigenciaVencida, requestRevision, revisionFolio, vigenciaDiasRestantes } from "@/lib/quotes/revisions";

const TZ = "America/Chihuahua";
const cfg = { timezone: TZ, holidays: [] as string[] };
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const iso = (d: Date) => DateTime.fromJSDate(d, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm");

describe("vigencia", () => {
  const q = { valid_until: "2026-03-17T12:00:00.000Z" };
  it("se calcula al consultar", () => {
    expect(isVigenciaVencida(q, new Date("2026-03-17T11:59:59Z"))).toBe(false);
    expect(isVigenciaVencida(q, new Date("2026-03-17T12:00:01Z"))).toBe(true);
    expect(isVigenciaVencida({ valid_until: null }, new Date())).toBe(false);
    expect(isVigenciaVencida(null, new Date())).toBe(false);
  });
  it("a los 15 dias naturales desde quoted_at", () => {
    const quoted = new Date("2026-03-02T15:00:00Z");
    const validUntil = new Date(quoted.getTime() + 15 * 86_400_000).toISOString();
    expect(isVigenciaVencida({ valid_until: validUntil }, new Date(quoted.getTime() + 14.9 * 86_400_000))).toBe(false);
    expect(isVigenciaVencida({ valid_until: validUntil }, new Date(quoted.getTime() + 15.1 * 86_400_000))).toBe(true);
    expect(vigenciaDiasRestantes({ valid_until: validUntil }, quoted)).toBe(15);
  });
});

describe("folios de revision", () => {
  it("v1 sin sufijo, v2 y v3 con -R", () => {
    expect(revisionFolio("COT-2026-0001-01", 1)).toBe("COT-2026-0001-01");
    expect(revisionFolio("COT-2026-0001-01", 2)).toBe("COT-2026-0001-01-R2");
    expect(revisionFolio("COT-2026-0001", 3)).toBe("COT-2026-0001-R3");
  });
  it("revision de la solicitud = version mas alta", () => {
    expect(requestRevision([])).toBe(1);
    expect(requestRevision([{ item_quotes: [{ version: 1 }] }, { item_quotes: [{ version: 1 }, { version: 3 }] }, {}])).toBe(3);
  });
});

describe("pausa del reloj por aclaracion", () => {
  // Enviada lunes 09:00, vence miercoles 09:00.
  const due = at("2026-03-04T09:00");
  const submitted = at("2026-03-02T09:00");

  it("sin pausas nada cambia", () => {
    expect(effectiveDueAt(due, [], at("2026-03-03T09:00"), cfg)).toEqual(due);
    expect(remainingWithPauses(due, [], at("2026-03-03T09:00"), cfg)).toBeCloseTo(24, 5);
  });

  it("una pausa cerrada de 10 horas habiles corre el vencimiento 10 horas", () => {
    const pauses = [{ clarification_requested_at: at("2026-03-02T12:00").toISOString(), resumed_at: at("2026-03-02T22:00").toISOString() }];
    expect(pausedBusinessHours(pauses, at("2026-03-03T00:00"), cfg)).toBeCloseTo(10, 5);
    expect(iso(effectiveDueAt(due, pauses, at("2026-03-03T00:00"), cfg))).toBe("2026-03-04 19:00");
  });

  it("mientras la pausa esta abierta el tiempo restante no baja", () => {
    const open = [{ clarification_requested_at: at("2026-03-02T12:00").toISOString(), resumed_at: null }];
    const r1 = remainingWithPauses(due, open, at("2026-03-02T15:00"), cfg);
    const r2 = remainingWithPauses(due, open, at("2026-03-03T08:00"), cfg);
    expect(r1).toBeCloseTo(45, 5);
    expect(r2).toBeCloseTo(45, 5);
  });

  it("el fin de semana dentro de la pausa no cuenta", () => {
    // Pausa viernes 12:00 a lunes 12:00: solo 12 + 12 = 24 horas habiles.
    const pauses = [{ clarification_requested_at: at("2026-03-06T12:00").toISOString(), resumed_at: at("2026-03-09T12:00").toISOString() }];
    expect(pausedBusinessHours(pauses, at("2026-03-10T00:00"), cfg)).toBeCloseTo(24, 5);
  });

  it("el tiempo de respuesta descuenta la pausa (estadisticas)", () => {
    const pauses = [{ clarification_requested_at: at("2026-03-02T12:00").toISOString(), resumed_at: at("2026-03-02T22:00").toISOString() }];
    const responded = at("2026-03-03T09:00");
    expect(netResponseHours(submitted, responded, pauses, cfg)).toBeCloseTo(24 - 10, 5);
    expect(netResponseHours(submitted, responded, [], cfg)).toBeCloseTo(24, 5);
  });

  it("una pausa abierta al responder se cuenta solo hasta la respuesta y nunca da negativo", () => {
    const open = [{ clarification_requested_at: at("2026-03-02T10:00").toISOString(), resumed_at: null }];
    expect(netResponseHours(submitted, at("2026-03-02T12:00"), open, cfg)).toBeCloseTo(1, 5);
    expect(netResponseHours(submitted, at("2026-03-02T09:00"), [], cfg)).toBe(0);
  });
});
