"use client";

import { activarEvaluacionAction, cerrarEvaluacionAction } from "@/actions/evaluaciones";
import { useRun } from "@/components/ops-ui";
import { Alert, Button } from "@/components/ui";

/** Activar (o adelantar) y cerrar el periodo de evaluacion. */
export function EvalControls({ tipo, activo, programado }: { tipo: "proveedores" | "clientes"; activo: boolean; programado: string | null }) {
  const { run, busy, notice } = useRun();
  return (
    <div className="space-y-2">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="flex flex-wrap gap-2">
        {!activo && (
          <Button loading={busy === "on"} onClick={() => run("on", () => activarEvaluacionAction(tipo), "Evaluación activa. Se avisó a quien le toca.")}>
            Activar evaluación {programado ? "ya (adelantar)" : ""}
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
