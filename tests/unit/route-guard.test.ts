import { describe, expect, it } from "vitest";
import { decideRoute, type GuardProfile } from "@/lib/auth/route-guard";

const seller: GuardProfile = { activo: true, must_change_password: false, rol: "vendedor" };
const buyer: GuardProfile = { activo: true, must_change_password: false, rol: "comprador" };
const mustChange: GuardProfile = { ...seller, must_change_password: true };
const inactive: GuardProfile = { ...seller, activo: false };

const d = (pathname: string, profile: GuardProfile | null, hasUser = true) =>
  decideRoute({ pathname, hasUser, profile });

describe("decideRoute", () => {
  it("sin sesion: paginas van a login, API responde 401", () => {
    expect(d("/vendedor", null, false)).toEqual({ type: "redirect", to: "/login" });
    expect(d("/login", null, false)).toEqual({ type: "next" });
    expect(d("/api/export", null, false)).toMatchObject({ type: "deny", status: 401 });
  });

  it("must_change_password bloquea todo salvo cambiar contrasena y logout", () => {
    expect(d("/vendedor", mustChange)).toEqual({ type: "redirect", to: "/cambiar-password" });
    expect(d("/comprador/usuarios", mustChange)).toEqual({ type: "redirect", to: "/cambiar-password" });
    expect(d("/", mustChange)).toEqual({ type: "redirect", to: "/cambiar-password" });
    expect(d("/api/export", mustChange)).toMatchObject({ type: "deny", status: 403, error: "debe_cambiar_contrasena" });
    expect(d("/cambiar-password", mustChange)).toEqual({ type: "next" });
    expect(d("/api/auth/logout", mustChange)).toEqual({ type: "next" });
  });

  it("usuario desactivado: sale de la sesion; API 403", () => {
    expect(d("/vendedor", inactive)).toMatchObject({ type: "redirect", signOut: true });
    expect(d("/vendedor", null)).toMatchObject({ type: "redirect", signOut: true });
    expect(d("/api/x", inactive)).toMatchObject({ type: "deny", status: 403 });
  });

  it("un vendedor no entra a rutas de comprador ni de administracion", () => {
    expect(d("/comprador/usuarios", seller)).toEqual({ type: "redirect", to: "/vendedor" });
    expect(d("/api/admin/usuarios", seller)).toMatchObject({ type: "deny", status: 403 });
    expect(d("/comprador/usuarios", buyer)).toEqual({ type: "next" });
  });

  it("un comprador no entra a rutas de vendedor", () => {
    expect(d("/vendedor/solicitudes/nueva", buyer)).toEqual({ type: "redirect", to: "/comprador" });
  });

  it("raiz y login redirigen al inicio del rol", () => {
    expect(d("/", seller)).toEqual({ type: "redirect", to: "/vendedor" });
    expect(d("/login", buyer)).toEqual({ type: "redirect", to: "/comprador" });
    expect(d("/cambiar-password", seller)).toEqual({ type: "redirect", to: "/vendedor" });
  });

  it("el cron usa su propio secreto", () => {
    expect(d("/api/cron/avisos", null, false)).toEqual({ type: "next" });
  });
});
