import { describe, expect, it } from "vitest";
import { adivinarColumnas, filaAProveedor, parseCsv } from "@/lib/proveedores-import";

describe("importar proveedores", () => {
  it("lee CSV con punto y coma, comillas y acentos", () => {
    const t = parseCsv('﻿Proveedor;Persona de contacto;Teléfono;E-mail;País\n"Shenzhen Clean Co., Ltd";Li Wei;+86 755 1234;SALES@X.CN;China\nGuantes MX;;;malcorreo;México\n');
    expect(t).toHaveLength(3);
    expect(t[1][0]).toBe("Shenzhen Clean Co., Ltd");
  });
  it("propone las columnas por encabezado y limpia cada fila", () => {
    const h = ["Proveedor", "Persona de contacto", "Teléfono", "E-mail", "País", "Nombre del contacto 2"];
    const m = adivinarColumnas(h);
    expect(m).toMatchObject({ nombre: 0, contacto_nombre: 1, telefono: 2, correo: 3, pais: 4 });
    expect(filaAProveedor(["Shenzhen", "Li Wei", "+86 1", "SALES@X.CN", "China"], m)).toMatchObject({ nombre: "Shenzhen", correo: "sales@x.cn", tipo: "extranjero" });
    expect(filaAProveedor(["Guantes MX", "", "", "malcorreo", "México"], m)).toMatchObject({ correo: null, tipo: "nacional", contacto_nombre: null });
    expect(filaAProveedor(["", "x"], m)).toBeNull();
  });
});
