import { describe, expect, it } from "vitest";
import { aFecha, aNumero, leerDocProveedor } from "@/lib/proforma-lector";

const PROVS = [{ id: "p1", nombre: "TSINGHAO" }, { id: "p2", nombre: "Hebei Glove Co., Ltd." }];

describe("lector de proformas y facturas de proveedor", () => {
  it("numeros y fechas en varios formatos", () => {
    expect(aNumero("USD 43,237.42")).toBe(43237.42);
    expect(aNumero("43.237,42")).toBe(43237.42);
    expect(aNumero("1,250")).toBe(1250);
    expect(aFecha("Nov. 6, 2026")).toBe("2026-11-06");
    expect(aFecha("06-Nov-2026")).toBe("2026-11-06");
    expect(aFecha("2026.11.06")).toBe("2026-11-06");
    expect(aFecha("2026年11月6日")).toBe("2026-11-06");
    expect(aFecha("06/11/2026")).toBe("2026-11-06");
    expect(aFecha("11/26/2026")).toBe("2026-11-26");
    expect(aFecha("10/Nov/26")).toBe("2026-11-10");
  });

  it("proforma china: PI, PO, fecha, total, 30% de anticipo y 70% de saldo", () => {
    const d = leerDocProveedor([
      "QINGDAO TSINGHAO INDUSTRY CO., LTD",
      "PROFORMA INVOICE",
      "PI NO.: TH-20261106   DATE: Nov. 6, 2026",
      "To: ESC REPRESENTACIONES SA DE CV",
      "PO NO.: 26JGH1104",
      "No. Description Qty(rolls) Unit Price(USD) Amount(USD)",
      "1 PET tape 48mm 12000 1.25 15,000.00",
      "2 Fiberglass mesh 8000 3.529678 28,237.42",
      "TOTAL QTY: 20000 rolls",
      "TOTAL AMOUNT: USD 43,237.42",
      "Payment terms: 30% T/T deposit, 70% balance before shipment",
    ], PROVS);
    expect(d).toMatchObject({
      tipo: "proforma", numero: "TH-20261106", oc: "26JGH1104", fecha: "2026-11-06", moneda: "USD", total: 43237.42,
      depositoPct: 30, deposito: 12971.23, saldoPct: 70, saldo: 30266.19, proveedorId: "p1",
    });
    expect(d.condiciones).toMatch(/30% T\/T/);
    expect(d.avisos).toEqual([]);
  });

  it("factura comercial final con saldo pendiente", () => {
    const d = leerDocProveedor([
      "HEBEI GLOVE CO., LTD",
      "COMMERCIAL INVOICE",
      "Invoice No: HG2026-0457",
      "Date: 2026-12-02",
      "Contract No.: 26JGH1104",
      "Total Value: USD 43,237.42",
      "Less deposit received: USD 12,971.23",
      "Balance due: USD 30,266.19",
    ], PROVS);
    expect(d).toMatchObject({ tipo: "factura", numero: "HG2026-0457", oc: "26JGH1104", fecha: "2026-12-02", total: 43237.42, deposito: 12971.23, saldo: 30266.19, proveedorId: "p2" });
  });

  it("proforma con el total en el renglon de arriba, fecha 10/Nov/26 y 100% por adelantado", () => {
    const d = leerDocProveedor([
      "Hubei Mingerkang Health & Safety Appliances Co., Ltd",
      "PROFORMA INVOICE",
      "Purchaser:  ESC Representaciones  Invoice No:  MEK260657/W0033",
      "Address: Chihuahua Mexico  CP 31105  PO No.  26HMG1109",
      "10/Nov/26",
      "Tel: (614) 424-6200  Date:",
      "Unit Price  Amount",
      "Microporous  173*67  White  $35.00  80  4,000  50*28*41  4.59  $2,800.00",
      "17.22  $10,500.00",
      "Total Amount :",
      "Total Amount In Writing: SAY US DOLLARS TEN THOUSAND AND FIVE HUNDRED ONLY.",
      "2. Payment : 100% by T/T in advance for less amount .",
    ], [{ id: "h", nombre: "HUBEI MINGERKANG" }]);
    expect(d).toMatchObject({ tipo: "proforma", numero: "MEK260657/W0033", oc: "26HMG1109", fecha: "2026-11-10", moneda: "USD", total: 10500, depositoPct: 100, deposito: 10500, proveedorId: "h", avisos: [] });
  });

  it("si no encuentra datos, avisa", () => {
    const d = leerDocProveedor(["hola"], PROVS);
    expect(d.avisos.length).toBe(3);
    expect(d.proveedorId).toBeNull();
  });
});
