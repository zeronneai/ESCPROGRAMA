import { describe, expect, it } from "vitest";
import { diasEntre, diasLey, isoDow, rangoRh, semanasDelMes } from "@/lib/rrhh";
import { decideRoute } from "@/lib/auth/route-guard";

describe("rrhh", () => {
  it("dias por ley (LFT art. 76)", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10, 11, 15, 16, 21, 26, 31].map(diasLey)).toEqual([0, 12, 14, 16, 18, 20, 22, 22, 24, 24, 26, 28, 30, 32]);
  });
  it("calendario del mes empieza en lunes", () => {
    const s = semanasDelMes(2026, 11); // diciembre 2026: el 1 es martes
    expect(s[0]).toEqual([null, "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(s.flat().filter(Boolean)).toHaveLength(31);
    expect(isoDow("2026-12-25")).toBe(5);
    expect(diasEntre("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(rangoRh("2026-12-22", "2027-01-04")).toBe("22 dic 2026 al 4 ene 2027");
  });
  it("solo gerente y CEO administran", () => {
    const p = (rol: "vendedor" | "gerente" | "ceo") => ({ activo: true, must_change_password: false, rol });
    expect(decideRoute({ pathname: "/rrhh", hasUser: true, profile: p("vendedor") })).toEqual({ type: "next" });
    expect(decideRoute({ pathname: "/rrhh/gerencia", hasUser: true, profile: p("vendedor") })).toEqual({ type: "redirect", to: "/rrhh" });
    expect(decideRoute({ pathname: "/rrhh/gerencia", hasUser: true, profile: p("ceo") })).toEqual({ type: "next" });
  });
});
