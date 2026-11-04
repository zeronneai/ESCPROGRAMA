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

describe("ayuda de lo nuevo", () => {
  it("visita sin venta, sucursales, minutas y quitar demo", () => {
    expect(searchFaq("fui con el cliente y no compro", "vendedor").best?.id).toBe("visita");
    expect(searchFaq("agregar sucursal", "vendedor").best?.id).toBe("sucursal");
    expect(searchFaq("como hago una minuta", "supervisor_finanzas").best?.id).toBe("minuta-crear");
    expect(searchFaq("firmar minuta", "vendedor").best?.id).toBe("minuta-firmar");
    expect(searchFaq("quitar demostracion", "comprador").best?.id).toBe("demo");
    expect(searchFaq("guia para tarima", "vendedor").best?.id).toBe("tarima");
  });
});

describe("documentos y control de cambios", () => {
  it("responde segun el puesto", () => {
    expect(searchFaq("subir documento pdf", "coordinador_iso").best?.id).toBe("documentos-subir");
    expect(searchFaq("donde veo la politica de calidad", "vendedor").best?.id).toBe("documentos-ver");
    expect(searchFaq("control de cambios", "gerente").best?.id).toBe("control-cambios");
  });
});
