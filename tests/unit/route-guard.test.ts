import { describe, expect, it } from "vitest";
import { decideRoute, type GuardProfile } from "@/lib/auth/route-guard";

const seller: GuardProfile = { activo: true, must_change_password: false, rol: "vendedor" };
const buyer: GuardProfile = { activo: true, must_change_password: false, rol: "comprador" };
const jefe: GuardProfile = { activo: true, must_change_password: false, rol: "jefe_ventas" };
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
    expect(d("/comprador/usuarios", seller)).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/api/admin/usuarios", seller)).toMatchObject({ type: "deny", status: 403 });
    expect(d("/comprador/usuarios", buyer)).toEqual({ type: "next" });
  });

  it("un comprador no entra a rutas de vendedor", () => {
    expect(d("/vendedor/solicitudes/nueva", buyer)).toEqual({ type: "redirect", to: "/inicio" });
  });

  it("raiz y login redirigen al inicio del rol", () => {
    expect(d("/", seller)).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/login", buyer)).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/cambiar-password", seller)).toEqual({ type: "redirect", to: "/inicio" });
  });

  it("el cron usa su propio secreto", () => {
    expect(d("/api/cron/avisos", null, false)).toEqual({ type: "next" });
  });

  it("la entrada de leads del sitio web usa su propio secreto (solo esa ruta)", () => {
    expect(d("/api/leads/entrada", null, false)).toEqual({ type: "next" });
    expect(d("/api/leads/otra", null, false)).toMatchObject({ type: "deny", status: 401 });
  });

  it("leads es solo para vendedores", () => {
    expect(d("/vendedor/leads", seller)).toEqual({ type: "next" });
    expect(d("/vendedor/leads", buyer)).toEqual({ type: "redirect", to: "/inicio" });
  });

  it("jefa de ventas: entra a /ventas; no a vendedor, comprador ni administracion", () => {
    expect(d("/", jefe)).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/login", jefe)).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/ventas", jefe)).toEqual({ type: "next" });
    expect(d("/ventas/vendedor/x", jefe)).toEqual({ type: "next" });
    expect(d("/vendedor/bitacora", jefe)).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/comprador/clientes", jefe)).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/api/admin/usuarios", jefe)).toMatchObject({ type: "deny", status: 403 });
  });

  it("/ventas: el comprador tambien entra (solo lectura); el vendedor no", () => {
    expect(d("/ventas", buyer)).toEqual({ type: "next" });
    expect(d("/ventas", seller)).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/ventasx", seller)).toEqual({ type: "next" });
  });

  it("gerente, coordinador ISO y Marketplaces van a su inicio y respetan sus areas", () => {
    const p = (rol: GuardProfile["rol"]): GuardProfile => ({ activo: true, must_change_password: false, rol });
    expect(d("/", p("gerente"))).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/", p("coordinador_iso"))).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/", p("marketplaces"))).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/ventas", p("gerente"))).toEqual({ type: "next" });
    expect(d("/ventas", p("coordinador_iso"))).toEqual({ type: "next" });
    expect(d("/ventas", p("marketplaces"))).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/calidad", p("marketplaces"))).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/calidad/quejas/x", seller)).toEqual({ type: "next" });
    expect(d("/guias", p("marketplaces"))).toEqual({ type: "next" });
    expect(d("/consumo", p("marketplaces"))).toEqual({ type: "next" });
    expect(d("/vendedor", p("gerente"))).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/comprador", p("coordinador_iso"))).toEqual({ type: "redirect", to: "/inicio" });
  });

  it("almacen va a evaluacion de proveedores; la encuesta del cliente se abre sin sesion", () => {
    const alm: GuardProfile = { activo: true, must_change_password: false, rol: "almacen" };
    expect(d("/", alm)).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/ventas", alm)).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/calidad", alm)).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/calidad/riesgos", alm)).toEqual({ type: "next" });
    expect(d("/calidad/riesgos/nuevo", { ...alm, rol: "supervisor_finanzas" })).toEqual({ type: "next" });
    expect(d("/calidad/riesgos", { ...alm, rol: "marketplaces" })).toEqual({ type: "redirect", to: "/inicio" });
    expect(d("/encuesta/abc", null, false)).toEqual({ type: "next" });
    // Link de quejas para clientes: sin sesion y tambien con sesion de cualquier puesto.
    expect(d("/quejas", null, false)).toEqual({ type: "next" });
    expect(d("/quejas", alm)).toEqual({ type: "next" });
    expect(d("/quejas/x", null, false)).toEqual({ type: "redirect", to: "/login" });
    // Catalogo oculto mientras se termina: la liga no abre.
    expect(d("/catalogo", null, false)).toEqual({ type: "redirect", to: "/login" });
    expect(d("/catalogo-esc-2026.pdf", alm)).toEqual({ type: "redirect", to: "/inicio" });
    // Cerrar sesion con la sesion vencida: no da error, el handler regresa al login.
    expect(d("/api/auth/logout", null, false)).toEqual({ type: "next" });
  });
});

describe("supervisores", () => {
  const p = (rol: GuardProfile["rol"]): GuardProfile => ({ activo: true, must_change_password: false, rol });
  it("supervisor de almacen va a evaluar proveedores; supervisor de finanzas a minutas", () => {
    expect(decideRoute({ pathname: "/", hasUser: true, profile: p("supervisor_almacen") })).toEqual({ type: "redirect", to: "/inicio" });
    expect(decideRoute({ pathname: "/", hasUser: true, profile: p("supervisor_finanzas") })).toEqual({ type: "redirect", to: "/inicio" });
    expect(decideRoute({ pathname: "/calidad", hasUser: true, profile: p("supervisor_finanzas") })).toEqual({ type: "redirect", to: "/inicio" });
    expect(decideRoute({ pathname: "/minutas/nueva", hasUser: true, profile: p("supervisor_finanzas") })).toEqual({ type: "next" });
  });
});

describe("ceo y pagos", () => {
  const p = (rol: GuardProfile["rol"]): GuardProfile => ({ activo: true, must_change_password: false, rol });
  it("el CEO entra a pagos; un vendedor no", () => {
    expect(decideRoute({ pathname: "/", hasUser: true, profile: p("ceo") })).toEqual({ type: "redirect", to: "/inicio" });
    expect(decideRoute({ pathname: "/pagos/oc/x", hasUser: true, profile: p("ceo") })).toEqual({ type: "next" });
    expect(decideRoute({ pathname: "/pagos", hasUser: true, profile: p("comprador") })).toEqual({ type: "next" });
    expect(decideRoute({ pathname: "/pagos", hasUser: true, profile: p("vendedor") })).toEqual({ type: "redirect", to: "/inicio" });
  });
});
