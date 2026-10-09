import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { computeDeadlineNotices } from "@/lib/quotes/deadlines";

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
