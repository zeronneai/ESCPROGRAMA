"use client";

import { useState } from "react";
import { activarEvaluacionAction, cerrarEvaluacionAction, fechaCierreEvaluacionAction } from "@/actions/evaluaciones";
import { useRun } from "@/components/ops-ui";
import { Alert, Button, Input } from "@/components/ui";

/** Activar (o adelantar), fecha de cierre y cerrar el periodo de evaluacion. */
export function EvalControls({ tipo, activo, programado, cierraEl = null }: { tipo: "proveedores" | "clientes"; activo: boolean; programado: string | null; cierraEl?: string | null }) {
  const { run, busy, notice } = useRun();
  const [hasta, setHasta] = useState(cierraEl ?? "");
  const conFecha = tipo === "clientes";
  return (
    <div className="space-y-2">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        {conFecha && (
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Disponible hasta</span>
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-44!" />
          </label>
        )}
        {!activo && (
          <Button loading={busy === "on"} onClick={() => run("on", () => activarEvaluacionAction(tipo, conFecha ? hasta || null : null), "Evaluación activa. Se avisó a quien le toca.")}>
            Activar evaluación {programado ? "ya (adelantar)" : ""}
          </Button>
        )}
        {activo && conFecha && (hasta || "") !== (cierraEl ?? "") && (
          <Button variant="secondary" loading={busy === "fecha"} onClick={() => run("fecha", () => fechaCierreEvaluacionAction(tipo, hasta || null), "Fecha de cierre actualizada.")}>
            Guardar fecha
          </Button>
        )}
        {activo && (
          <Button variant="secondary" loading={busy === "off"} onClick={() => { if (window.confirm("¿Cerrar el periodo? Ya no se podrá calificar.")) run("off", () => cerrarEvaluacionAction(tipo), "Periodo cerrado."); }}>
            Cerrar periodo
          </Button>
        )}
      </div>
    </div>
  );
}
