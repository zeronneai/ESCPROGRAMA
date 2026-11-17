import { describe, expect, it } from "vitest";
import { contenidoOc, domicilioOc, fechaMicrosip, leerOcMicrosip } from "@/lib/oc-microsip";
import { partirDireccion } from "@/lib/ops/guias";

// Posiciones reales de una OC de Microsip (CARNIPROTEK, folio 700).
const raw: [number, number, string][] = [
  [199, 796, "Orden de compra"], [27, 787, "ESC REPRESENTACIONES S. DE R. L."], [27, 776, "MI."], [440, 773, "Fecha"], [531, 773, "Folio"],
  [27, 766, "HEROICO COLEGIO MILITAR 5910-C"], [424, 757, "13/nov./2026"], [509, 757, "700"], [27, 756, "NOMBRE DE DIOS"],
  [27, 746, "CHIHUAHUA, CHIHUAHUA CP: 31105"], [27, 736, "RFC: ERE060228NLA"], [141, 716, "Proveedor"], [412, 716, "Consignatario"],
  [28, 703, "CARNIPROTEK S.A DE C.V"], [28, 676, "MIGUEL ALLENDE 37-A"], [28, 663, "PRADERAS DE SAN MATEO"], [28, 649, "NAUCALPAN, EDO MEX CP: 53228"],
  [43, 631, "Entrega"], [125, 631, "Condiciones"], [226, 631, "Vía de embarque"], [35, 617, "13/nov./2026"], [95, 617, "15 DIAS"], [206, 617, "Aeroflash"],
  [43, 601, "Artículo"], [188, 601, "Nombre"], [323, 601, "U.med."], [366, 601, "Unidades"], [431, 601, "Precio"], [484, 601, "Descto."], [538, 601, "Importe"],
  [27, 589, "ESC-TTH18295"], [95, 589, "Tela Encerada para Cubierta de Huesos, caja con 2 rollos de"], [317, 589, "CAJA"], [401, 589, "50"],
  [443, 589, "1,750.00"], [548, 589, "87,500.00"], [95, 579, "18\" X 295'"],
  [27, 163, "(Ciento un mil quinientos pesos 00/100 m.n.)"], [419, 163, "Subtotal"], [548, 163, "87,500.00"], [419, 153, "IVA AL 16%"], [548, 153, "14,000.00"],
  [27, 133, "CAJAS DE TAPAHUESO"], [419, 84, "Total"], [544, 84, "101,500.00"],
];
const textos = raw.map(([x, y, s]) => ({ x, y, s, pagina: 1 }));

describe("OC de Microsip", () => {
  it("lee folio, proveedor, domicilio, via, articulos y subtotal", () => {
    const oc = leerOcMicrosip(textos);
    expect(oc).toMatchObject({ folio: "700", fecha: "2026-11-13", proveedor: "CARNIPROTEK S.A DE C.V", via: "Aeroflash", subtotal: 87500, moneda: "MXN" });
    expect(oc.direccion).toBe("MIGUEL ALLENDE 37-A, PRADERAS DE SAN MATEO, NAUCALPAN, EDO MEX CP: 53228");
    expect(oc.articulos).toEqual([{ clave: "ESC-TTH18295", nombre: "Tela Encerada para Cubierta de Huesos, caja con 2 rollos de 18\" X 295'", cantidad: 50, unidad: "CAJA" }]);
    expect(contenidoOc(oc)).toBe("50 CAJA Tela Encerada para Cubierta de Huesos, caja con 2 rollos de 18\" X 295'");
    expect(domicilioOc(oc, partirDireccion)).toEqual({ calle_numero: "MIGUEL ALLENDE 37-A", colonia: "PRADERAS DE SAN MATEO", cp: "53228", ciudad: "Naucalpan", estado_geo: "Estado de México" });
  });
  it("fechas", () => {
    expect(fechaMicrosip("5/dic./2026")).toBe("2026-12-05");
    expect(fechaMicrosip("05/12/2026")).toBe("2026-12-05");
    expect(fechaMicrosip("xx")).toBeNull();
  });
});
