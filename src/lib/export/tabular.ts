import ExcelJS from "exceljs";

export type Cell = string | number | boolean | null | undefined;
export interface Table {
  name: string;
  columns: string[];
  rows: Cell[][];
}

/** CSV con BOM para que Excel respete los acentos. */
export function toCsv(t: Table): string {
  const esc = (c: Cell) => {
    const s = c === null || c === undefined ? "" : String(c);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [t.columns, ...t.rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

export async function toXlsx(t: Table): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.name.slice(0, 31));
  ws.addRow(t.columns).font = { bold: true };
  for (const r of t.rows) ws.addRow(r.map((c) => c ?? null));
  ws.columns.forEach((col, i) => {
    const max = Math.max(t.columns[i].length, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? "").length));
    col.width = Math.min(60, Math.max(10, max + 2));
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
