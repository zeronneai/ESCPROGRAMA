import { expect, it } from "vitest";
import { leerOcPegatron, type TextoPdf } from "@/lib/pegatron-po";

// Posiciones reales de la tabla de una P/O de Pegatron (pagina 1), con un segundo renglon agregado.
const TABLA: TextoPdf[] = [
  {"x": 126.2, "y": 463.3, "s": "Miguel de la Madrid 9650Col. Puente Alto32695 Cd Juárez, Chihuahua.", "pagina": 1},
  {"x": 39.1, "y": 451.6, "s": "ITEM", "pagina": 1},
  {"x": 40.5, "y": 441.2, "s": "COO", "pagina": 1},
  {"x": 29.1, "y": 431.9, "s": "Restriction", "pagina": 1},
  {"x": 77.2, "y": 447.3, "s": "PART", "pagina": 1},
  {"x": 71.7, "y": 438.3, "s": "NUMBER", "pagina": 1},
  {"x": 73.9, "y": 429.4, "s": "OEMPN", "pagina": 1},
  {"x": 106.6, "y": 442.8, "s": "DESCRIPTI", "pagina": 1},
  {"x": 119.4, "y": 433.9, "s": "ON", "pagina": 1},
  {"x": 147.4, "y": 451.8, "s": "MARKING", "pagina": 1},
  {"x": 153.3, "y": 442.8, "s": "CODE", "pagina": 1},
  {"x": 152.2, "y": 433.9, "s": "MRPID", "pagina": 1},
  {"x": 148.1, "y": 424.9, "s": "HSN/SAC", "pagina": 1},
  {"x": 193.7, "y": 442.8, "s": "UNIT", "pagina": 1},
  {"x": 191.3, "y": 433.9, "s": "PRICE", "pagina": 1},
  {"x": 233.2, "y": 438.3, "s": "QTY", "pagina": 1},
  {"x": 270.6, "y": 438.3, "s": "UNIT", "pagina": 1},
  {"x": 310, "y": 442.8, "s": "SUB", "pagina": 1},
  {"x": 306.1, "y": 433.9, "s": "TOTAL", "pagina": 1},
  {"x": 340.8, "y": 442.5, "s": "RECEIVED", "pagina": 1},
  {"x": 349.6, "y": 434.8, "s": "QTY", "pagina": 1},
  {"x": 380.8, "y": 442.2, "s": "RETURNED", "pagina": 1},
  {"x": 389.2, "y": 435.8, "s": "QTY", "pagina": 1},
  {"x": 414.6, "y": 442.8, "s": "DEFICIENT", "pagina": 1},
  {"x": 425.4, "y": 433.9, "s": "QTY", "pagina": 1},
  {"x": 454.8, "y": 451.8, "s": "SCHEDUL", "pagina": 1},
  {"x": 468.6, "y": 442.8, "s": "E", "pagina": 1},
  {"x": 454.3, "y": 433.9, "s": "DELIVERY", "pagina": 1},
  {"x": 461.9, "y": 424.9, "s": "DATE", "pagina": 1},
  {"x": 497.9, "y": 438.3, "s": "BUYER", "pagina": 1},
  {"x": 531.1, "y": 442.8, "s": "APPLICAN", "pagina": 1},
  {"x": 545.6, "y": 433.9, "s": "T", "pagina": 1},
  {"x": 28.4, "y": 414.6, "s": "10", "pagina": 1},
  {"x": 68.4, "y": 413.3, "s": "48M0-", "pagina": 1},
  {"x": 68.4, "y": 403, "s": "01N9000", "pagina": 1},
  {"x": 106.7, "y": 413.3, "s": "WIPER", "pagina": 1},
  {"x": 106.7, "y": 403, "s": "PAPER", "pagina": 1},
  {"x": 106.7, "y": 392.8, "s": "ROLL", "pagina": 1},
  {"x": 106.7, "y": 382.5, "s": "(PMX)", "pagina": 1},
  {"x": 106.7, "y": 372.3, "s": "MYESDE/", "pagina": 1},
  {"x": 106.7, "y": 362, "s": "WR11060", "pagina": 1},
  {"x": 106.7, "y": 351.8, "s": "30158/51", "pagina": 1},
  {"x": 106.7, "y": 341.5, "s": "0mm*10M", "pagina": 1},
  {"x": 146, "y": 413.3, "s": "WR11060", "pagina": 1},
  {"x": 152.4, "y": 403, "s": "30158", "pagina": 1},
  {"x": 152.4, "y": 392.8, "s": "0WFY", "pagina": 1},
  {"x": 204.4, "y": 413.3, "s": "4.66", "pagina": 1},
  {"x": 240.8, "y": 413.3, "s": "1257", "pagina": 1},
  {"x": 273.5, "y": 413.3, "s": "RL", "pagina": 1},
  {"x": 307, "y": 413.3, "s": "5857.62", "pagina": 1},
  {"x": 369, "y": 413.3, "s": "0", "pagina": 1},
  {"x": 407.3, "y": 413.3, "s": "0 1257", "pagina": 1},
  {"x": 453.1, "y": 413.3, "s": "11/30/202", "pagina": 1},
  {"x": 453.1, "y": 403, "s": "6", "pagina": 1},
  {"x": 491.6, "y": 413.3, "s": "王樹平", "pagina": 1},
  {"x": 529.9, "y": 413.3, "s": "91008675", "pagina": 1},
  {"x": 529.9, "y": 403, "s": "59-1", "pagina": 1},
  {"x": 71.8, "y": 295.5, "s": "稅額：", "pagina": 1},
  {"x": 106.7, "y": 296.1, "s": "937.22", "pagina": 1},
  {"x": 283.3, "y": 295.5, "s": "合計：", "pagina": 1},
  {"x": 454.3, "y": 295.5, "s": "6794.84 (含稅)", "pagina": 1},
];
const ENCABEZADO: TextoPdf[] = [
  { x: 28, y: 640, s: "P/O NUMBER:", pagina: 1 }, { x: 120, y: 640, s: "0920711410", pagina: 1 },
  { x: 300, y: 640, s: "PURCHASE DATE:", pagina: 1 }, { x: 400, y: 640, s: "11/12/2026", pagina: 1 },
  { x: 28, y: 630, s: "CURRENCY:", pagina: 1 }, { x: 120, y: 630, s: "USD", pagina: 1 },
];
const SEGUNDO: TextoPdf[] = [
  { x: 28, y: 330, s: "20", pagina: 1 }, { x: 68, y: 330, s: "46A1-", pagina: 1 }, { x: 68, y: 320, s: "0022", pagina: 1 },
  { x: 107, y: 330, s: "GLOVE", pagina: 1 }, { x: 107, y: 320, s: "NITRILE M", pagina: 1 },
  { x: 204, y: 330, s: "2.10", pagina: 1 }, { x: 238, y: 330, s: "1,500", pagina: 1 }, { x: 273, y: 330, s: "BX", pagina: 1 },
  { x: 453, y: 330, s: "12/05/2026", pagina: 1 },
];

it("lee la orden de compra de Pegatron: descripcion y cantidad por renglon", () => {
  const oc = leerOcPegatron([...ENCABEZADO, ...TABLA]);
  expect(oc).toMatchObject({ po_numero: "0920711410", fecha: "2026-11-12", moneda: "USD" });
  expect(oc.lineas).toEqual([
    { item: "10", numero_parte: "48M0-01N9000", descripcion: "WIPER PAPER ROLL (PMX) MYESDE/ WR11060 30158/51 0mm*10M", cantidad: 1257, unidad: "RL", entrega: "2026-11-30" },
  ]);
  const dos = leerOcPegatron([...ENCABEZADO, ...TABLA, ...SEGUNDO]);
  expect(dos.lineas.map((l) => [l.item, l.descripcion, l.cantidad, l.unidad, l.entrega])).toEqual([
    ["10", "WIPER PAPER ROLL (PMX) MYESDE/ WR11060 30158/51 0mm*10M", 1257, "RL", "2026-11-30"],
    ["20", "GLOVE NITRILE M", 1500, "BX", "2026-12-05"],
  ]);
});
