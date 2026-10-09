import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  addBusinessHours,
  businessHoursBetween,
  semaforo,
} from "@/lib/time/business-hours";

const TZ = "America/Chihuahua";
const cfg = (holidays: string[] = []) => ({ timezone: TZ, holidays });
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const show = (d: Date) =>
  DateTime.fromJSDate(d, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm");

// 2026-03-02 es lunes.
describe("addBusinessHours", () => {
  it("lunes 09:00 vence miercoles 09:00", () => {
    expect(show(addBusinessHours(at("2026-03-02T09:00"), 48, cfg()))).toBe(
      "2026-03-04 09:00",
    );
  });

  it("viernes 15:00 vence martes 15:00 (fin de semana pausado)", () => {
    expect(show(addBusinessHours(at("2026-03-06T15:00"), 48, cfg()))).toBe(
      "2026-03-10 15:00",
    );
  });

  it("sabado 11:00 arranca el lunes 00:00 y vence miercoles 00:00", () => {
    expect(show(addBusinessHours(at("2026-03-07T11:00"), 48, cfg()))).toBe(
      "2026-03-11 00:00",
    );
  });

  it("domingo a cualquier hora arranca el lunes 00:00", () => {
    for (const t of ["00:00", "13:30", "23:59"]) {
      expect(show(addBusinessHours(at(`2026-03-08T${t}`), 48, cfg()))).toBe(
        "2026-03-11 00:00",
      );
    }
  });

  it("un festivo en el rango se salta completo", () => {
    // Lunes 09:00 con martes festivo: 15h lunes, miercoles 24h, jueves 9h.
    expect(
      show(addBusinessHours(at("2026-03-02T09:00"), 48, cfg(["2026-03-03"]))),
    ).toBe("2026-03-05 09:00");
  });

  it("festivo en viernes junto al fin de semana", () => {
    // Jueves 12:00, viernes festivo: 12h jueves, lunes 24h, martes 12h.
    expect(
      show(addBusinessHours(at("2026-03-05T12:00"), 48, cfg(["2026-03-06"]))),
    ).toBe("2026-03-10 12:00");
  });

  it("inicio en festivo arranca al siguiente dia habil 00:00", () => {
    expect(
      show(addBusinessHours(at("2026-03-02T10:00"), 24, cfg(["2026-03-02"]))),
    ).toBe("2026-03-04 00:00");
  });

  it("0 horas en dia habil no mueve la fecha", () => {
    expect(show(addBusinessHours(at("2026-03-02T09:00"), 0, cfg()))).toBe(
      "2026-03-02 09:00",
    );
  });

  it("respeta la zona horaria configurada", () => {
    // 2026-03-02T05:00Z es domingo 23:00 en Chihuahua (UTC-6): inhabil.
    const start = new Date("2026-03-02T05:00:00Z");
    expect(show(addBusinessHours(start, 1, cfg()))).toBe("2026-03-02 01:00");
    const utcCfg = { timezone: "UTC", holidays: [] };
    const out = DateTime.fromJSDate(addBusinessHours(start, 1, utcCfg), {
      zone: "UTC",
    }).toFormat("yyyy-MM-dd HH:mm");
    expect(out).toBe("2026-03-02 06:00");
  });
});

describe("businessHoursBetween", () => {
  it("es el inverso de addBusinessHours", () => {
    const start = at("2026-03-06T15:00");
    const due = addBusinessHours(start, 48, cfg());
    expect(businessHoursBetween(start, due, cfg())).toBeCloseTo(48, 6);
  });

  it("no cuenta fin de semana", () => {
    expect(
      businessHoursBetween(at("2026-03-06T20:00"), at("2026-03-09T04:00"), cfg()),
    ).toBeCloseTo(8, 6);
  });

  it("no cuenta festivos", () => {
    expect(
      businessHoursBetween(
        at("2026-03-02T12:00"),
        at("2026-03-04T12:00"),
        cfg(["2026-03-03"]),
      ),
    ).toBeCloseTo(24, 6);
  });

  it("negativo cuando to < from", () => {
    expect(
      businessHoursBetween(at("2026-03-03T00:00"), at("2026-03-02T00:00"), cfg()),
    ).toBeCloseTo(-24, 6);
  });
});

describe("semaforo", () => {
  it.each([
    [48, "verde"],
    [24, "verde"],
    [23.9, "amarillo"],
    [6, "amarillo"],
    [5.9, "rojo"],
    [0.1, "rojo"],
    [0, "vencida"],
    [-3, "vencida"],
  ])("%d h -> %s", (h, expected) => {
    expect(semaforo(h)).toBe(expected);
  });
});
