import { describe, expect, it } from "vitest";
import { FAQ, searchFaq, suggestions } from "@/lib/ayuda/faq";

describe("asistente de ayuda", () => {
  it("encuentra la respuesta por palabras, sin acentos ni mayusculas", () => {
    expect(searchFaq("¿Cómo registro una VENTA?", "vendedor").best?.id).toBe("venta-diaria");
    expect(searchFaq("pedir guia dhl", "vendedor").best?.id).toBe("pedir-guia");
    expect(searchFaq("olvidé mi contraseña", "vendedor").best?.id).toBe("password");
    expect(searchFaq("cartera vencida", "vendedor").best?.id).toBe("cartera");
    expect(searchFaq("dar de alta un prospecto", "vendedor").best?.id).toBe("alta-cliente");
    expect(searchFaq("como lleno la accion correctiva", "coordinador_iso").best?.id).toBe("sac");
  });
  it("solo responde lo del puesto y no inventa", () => {
    expect(searchFaq("como creo usuarios", "vendedor").best?.id).not.toBe("usuarios");
    expect(searchFaq("como creo usuarios", "comprador").best?.id).toBe("usuarios");
    expect(searchFaq("xyz qwerty", "vendedor").best).toBeNull();
  });
  it("sugiere primero lo de la pagina actual", () => {
    expect(suggestions("vendedor", "/guias")[0].id).toBe("pedir-guia");
    expect(suggestions("marketplaces", "/guias")[0].id).toBe("mkt-atender");
  });
  it("las respuestas no usan rayas largas", () => {
    expect(FAQ.every((f) => ![f.q, ...f.a].join(" ").includes("—"))).toBe(true);
  });
});

describe("sugerencias por pagina", () => {
  it("en la bitacora sugiere primero ventas y prospeccion", () => {
    expect(suggestions("vendedor", "/vendedor/bitacora").slice(0, 2).map((f) => f.id)).toEqual(expect.arrayContaining(["venta-diaria"]));
    expect(suggestions("vendedor", "/vendedor").map((f) => f.id)).toContain("nueva-solicitud");
  });
});
