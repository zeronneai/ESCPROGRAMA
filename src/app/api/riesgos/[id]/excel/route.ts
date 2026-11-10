import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { CRITERIOS, INSTRUCCIONES, nivelRoe, normalizar, roe } from "@/lib/riesgos";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const COLS: { h: string; w: number }[] = [
  { h: "Artículo / Actividad", w: 24 }, { h: "Modo Potencial de Falla", w: 28 }, { h: "Efectos Potenciales de la Falla", w: 30 }, { h: "Vinculado con", w: 18 },
  { h: "Riesgo / Oportunidad", w: 13 },
  { h: "Severidad", w: 6 }, { h: "Causas Potenciales / Mecanismos de Fallas", w: 28 }, { h: "Ocurrencia", w: 6 }, { h: "Controles Actuales de Prevención", w: 26 }, { h: "Controles Actuales de Detección", w: 26 }, { h: "Detección", w: 6 },
  { h: "Nivel de Riesgo", w: 9 },
  { h: "Acciones Recomendadas a Realizar", w: 30 }, { h: "Responsable", w: 16 }, { h: "Fecha Terminación", w: 12 },
  { h: "Acciones Tomadas", w: 28 }, { h: "Fecha de verificación", w: 12 }, { h: "Severidad", w: 6 }, { h: "Ocurrencia", w: 6 }, { h: "Detección", w: 6 }, { h: "Nivel de Riesgo Residual", w: 9 },
];
// Grupos del encabezado como en el formato (columna inicial, final, titulo, color).
const GRUPOS: [number, number, string, string][] = [
  [1, 4, "Identificación de Riesgo", "FFFFFF00"], [5, 5, "Clasificación", "FFC4BD97"], [6, 11, "Análisis del Riesgo", "FF99CCFF"],
  [12, 12, "ROE", "FF99CCFF"], [13, 15, "Tratamiento del riesgo / Plan de Trabajo", "FFF2DCDB"], [16, 21, "Fecha y Monitoreo de la efectividad", "FF92D050"],
];
const ROE_FILL = { bajo: "FF33CC33", medio: "FFFFFF00", alto: "FFFF0000" } as const;
const fecha = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "");

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("riesgo_analisis").select("folio, proceso, fecha, autor_nombre, actividades").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Calidad", { views: [{ state: "frozen", ySplit: 6 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const borde = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } } as const;
  COLS.forEach((c, i) => (ws.getColumn(i + 1).width = c.w));

  ws.mergeCells(1, 1, 1, COLS.length);
  ws.getCell(1, 1).value = "ANÁLISIS Y EVALUACIÓN DE RIESGO";
  ws.getCell(1, 1).font = { bold: true, size: 18 };
  ws.getCell(1, 1).alignment = { horizontal: "center" };
  ws.getRow(1).height = 30;
  ws.getCell(3, 1).value = "NOMBRE DE PROCESO :";
  ws.mergeCells(3, 2, 3, 11);
  ws.getCell(3, 2).value = data.proceso;
  ws.getCell(3, 13).value = "FECHA DEL ANÁLISIS :";
  ws.mergeCells(3, 14, 3, 15);
  ws.getCell(3, 14).value = fecha(data.fecha);
  ws.getCell(3, 17).value = `Folio ${data.folio} · ${data.autor_nombre ?? ""}`;
  for (const c of [1, 13]) {
    ws.getCell(3, c).font = { bold: true, size: 9 };
    ws.getCell(3, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
  }

  for (const [a, b, t, color] of GRUPOS) {
    if (b > a) ws.mergeCells(5, a, 5, b);
    const c = ws.getCell(5, a);
    c.value = t;
    for (let k = a; k <= b; k++) {
      ws.getCell(5, k).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      ws.getCell(6, k).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      ws.getCell(5, k).border = borde;
    }
    c.font = { bold: true, size: 10 };
    c.alignment = { horizontal: "center", vertical: "middle" };
  }
  COLS.forEach((col, i) => {
    const c = ws.getCell(6, i + 1);
    c.value = col.h;
    c.font = { bold: true, size: 9 };
    c.border = borde;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true, textRotation: col.w <= 6 ? 90 : 0 };
  });
  ws.getRow(6).height = 60;

  let r = 7;
  for (const a of normalizar(data.actividades)) {
    const modos = a.modos.filter((m) => m.modo.trim() || m.efectos.trim() || m.severidad);
    const ini = r;
    for (const m of modos) {
      const n1 = roe(m.severidad, m.ocurrencia, m.deteccion);
      const n2 = roe(m.severidad_r, m.ocurrencia_r, m.deteccion_r);
      const vals = [
        a.actividad, m.modo, m.efectos, m.vinculado, m.tipo === "oportunidad" ? "Oportunidad" : "Riesgo",
        m.severidad, m.causas, m.ocurrencia, m.prevencion, m.deteccion_ctrl, m.deteccion, n1,
        m.acciones, m.responsable, fecha(m.fecha_terminacion), m.acciones_tomadas, fecha(m.fecha_verificacion), m.severidad_r, m.ocurrencia_r, m.deteccion_r, n2,
      ];
      vals.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = v === "" || v == null ? null : v;
        c.border = borde;
        c.font = { size: 9 };
        c.alignment = { vertical: "top", wrapText: true, horizontal: typeof v === "number" ? "center" : "left" };
      });
      for (const [col, n] of [[12, n1], [21, n2]] as const) {
        const lvl = nivelRoe(n);
        if (lvl) {
          ws.getCell(r, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROE_FILL[lvl] } };
          ws.getCell(r, col).font = { size: 10, bold: true, color: { argb: lvl === "medio" ? "FF000000" : "FFFFFFFF" } };
          ws.getCell(r, col).alignment = { horizontal: "center", vertical: "middle" };
        }
      }
      if ((m.severidad ?? 0) >= 4) {
        ws.getCell(r, 6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
        ws.getCell(r, 6).font = { size: 9, bold: true, color: { argb: "FFFFFFFF" } };
      }
      r++;
    }
    if (r - ini > 1) {
      ws.mergeCells(ini, 1, r - 1, 1);
      ws.getCell(ini, 1).alignment = { vertical: "middle", wrapText: true };
    }
  }

  // Hoja de criterios
  const cr = wb.addWorksheet("Criterios");
  cr.columns = [{ width: 12 }, { width: 70 }, { width: 45 }, { width: 50 }];
  cr.addRow(["Calificación", "Severidad", "Ocurrencia", "Detección"]).font = { bold: true };
  for (let i = 0; i < 5; i++) {
    const row = cr.addRow([i + 1, CRITERIOS.severidad.niveles[i].texto.join("\n"), CRITERIOS.ocurrencia.niveles[i].texto.join("\n"), CRITERIOS.deteccion.niveles[i].texto.join("\n")]);
    row.alignment = { wrapText: true, vertical: "top" };
  }
  cr.addRow([]);
  cr.addRow(["Nivel de riesgo (ROE) = Severidad x Ocurrencia x Detección: menos de 25 bajo (verde), de 25 a 74 medio (amarillo), 75 o más alto (rojo)."]);
  // Instrucciones
  const ins = wb.addWorksheet("Inst de llenado");
  ins.columns = [{ width: 6 }, { width: 34 }, { width: 90 }];
  ins.addRow(["", "Instrucciones de Llenado de Formato Análisis y Evaluación de Riesgo"]).font = { bold: true };
  for (const i of INSTRUCCIONES) ins.addRow([i.n, i.campo, i.texto]);

  const buf = await wb.xlsx.writeBuffer();
  const nombre = `${data.folio} Analisis de riesgo ${data.proceso}`.replace(/[^\w .-]+/g, "").slice(0, 80);
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}.xlsx"`,
    },
  });
}
