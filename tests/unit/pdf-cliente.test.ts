import { expect, it, vi } from "vitest";
vi.mock("pdfjs-dist", () => ({}));
import { leerConstancia } from "@/lib/pdf-cliente";

it("constancia de situacion fiscal: RFC, razon social, direccion y estado", () => {
  const l = [
    "CONSTANCIA DE SITUACIÓN FISCAL",
    "RFC:  IND010101AB1",
    "Denominación/Razón Social:  INDUSTRIAS DEL NORTE SA DE CV",
    "Código Postal:31125  Tipo de Vialidad: AVENIDA",
    "Nombre de Vialidad: TECNOLOGICO  Número Exterior: 1200",
    "Número Interior:  Nombre de la Colonia: PARQUE INDUSTRIAL",
    "Nombre de la Localidad: CHIHUAHUA  Nombre del Municipio o Demarcación Territorial: CHIHUAHUA",
    "Nombre de la Entidad Federativa: CHIHUAHUA  Entre Calle: X",
  ];
  expect(leerConstancia(l)).toMatchObject({
    rfc: "IND010101AB1", razon_social: "INDUSTRIAS DEL NORTE SA DE CV", estado_geo: "Chihuahua", fuente: "constancia",
    direccion: "AVENIDA TECNOLOGICO 1200, COL. PARQUE INDUSTRIAL, CHIHUAHUA, CHIHUAHUA, CP 31125",
  });
  expect(leerConstancia(["Factura", "Serie y folio: F1"])).toBeNull();
});
