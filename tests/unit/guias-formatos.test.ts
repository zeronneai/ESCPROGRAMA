import { expect, it } from "vitest";
import { guiaSchema, limpiaNumero } from "@/lib/ops/guias";
it("formatos libres", () => {
  expect(limpiaNumero("$3,480.00")).toBe(3480); expect(limpiaNumero("120 cm")).toBe(120); expect(limpiaNumero("1,5")).toBe(1.5); expect(limpiaNumero("5 kg")).toBe(5); expect(limpiaNumero("")).toBeNull();
  const v = { factura: "F11341", destinatario: "Jose", paqueteria: "DHL", servicio: "estandar", customer_id: "", telefono: "614 551 9914", correo: " ", calle_numero: "Mariano 9021",
    cp: "C.P. 31416", ciudad: "Chihuahua", estado_geo: "Chihuahua", valor_declarado: "$3,480.00", asegurar: false, urgente: false,
    partidas: [{ empaque: "tarima", cantidad: "2", peso_kg: "150 kg", largo_cm: "120 cm", ancho_cm: "100", alto_cm: "", descripcion: "" }] };
  const r = guiaSchema.parse(v);
  expect(r).toMatchObject({ cp: "31416", correo: null, valor_declarado: 3480, peso_kg: 300, largo_cm: 120, customer_id: null });
  expect(guiaSchema.safeParse({ ...v, correo: "juan@" }).error?.issues[0].message).toMatch(/correo/);
});
import { partirDireccion } from "@/lib/ops/guias";
it("partir la direccion de la factura", () => {
  expect(partirDireccion("MARIANO GUILLEN No. 9021, COL. LOS PINOS, CHIHUAHUA, CHIH. CP: 31416")).toEqual({
    calle_numero: "MARIANO GUILLEN No. 9021", colonia: "LOS PINOS", cp: "31416", ciudad: "Chihuahua", estado_geo: "Chihuahua",
  });
  expect(partirDireccion("C.Apicultura, No. 12403, Col. Zootecnia")).toEqual({ calle_numero: "C.Apicultura, No. 12403", colonia: "Zootecnia", cp: "", ciudad: "", estado_geo: "" });
  expect(partirDireccion("Av. Tecnológico 1200, Cd. Juárez, Chih., C.P. 32500")).toMatchObject({ calle_numero: "Av. Tecnológico 1200", ciudad: "Cd. Juárez", estado_geo: "Chihuahua", cp: "32500" });
  expect(partirDireccion("")).toEqual({ calle_numero: "", colonia: "", cp: "", ciudad: "", estado_geo: "" });
});
