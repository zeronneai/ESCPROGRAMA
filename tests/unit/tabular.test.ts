import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { toCsv, toXlsx } from "@/lib/export/tabular";

const t = { name: "Prueba", columns: ["A", "B"], rows: [["x,y", 'dice "hola"'], [1, null]] };

describe("exportaciones", () => {
  it("CSV escapa comas y comillas y lleva BOM", () => {
    const csv = toCsv(t);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"x,y","dice ""hola"""');
    expect(csv).toContain("1,\r\n");
  });
  it("XLSX se puede abrir y conserva los datos", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toXlsx(t)) as never);
    const ws = wb.getWorksheet("Prueba")!;
    expect(ws.getRow(1).values).toEqual([undefined, "A", "B"]);
    expect(ws.getRow(2).getCell(1).value).toBe("x,y");
    expect(ws.getRow(3).getCell(1).value).toBe(1);
  });
});
