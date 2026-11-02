"use client";

import { useState } from "react";
import { guardarEvalProveedorAction } from "@/actions/evaluaciones";
import { areaCls, useRun } from "@/components/ops-ui";
import { Alert, Button, Card } from "@/components/ui";
import { ESCALA_PROVEEDOR, type Pregunta } from "@/lib/evaluaciones";

export function EvalLado({
  evalId, titulo, preguntas, resp, comentario, quien, cuando, editable,
}: {
  evalId: string;
  titulo: string;
  preguntas: Pregunta[];
  resp: Record<string, number>;
  comentario: string | null;
  quien: string | null;
  cuando: string | null;
  editable: boolean;
}) {
  const [v, setV] = useState<Record<string, number>>(resp);
  const [c, setC] = useState(comentario ?? "");
  const { run, busy, notice } = useRun();
  const faltan = preguntas.filter((p) => !v[p.id]).length;
  const prom = preguntas.length && !faltan ? Math.round((preguntas.reduce((a, p) => a + v[p.id], 0) / preguntas.length) * 20) : null;
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">{titulo}</h2>
        <span className="text-xs text-slate-500">
          {cuando ? `Calificó ${quien ?? ""} el ${new Date(cuando).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}` : "Pendiente"}
          {prom !== null && ` · ${prom}%`}
        </span>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <ol className="space-y-3">
        {preguntas.map((p, i) => (
          <li key={p.id} className="space-y-1.5">
            <p className="text-sm font-medium text-slate-800">{i + 1}. {p.texto}</p>
            {p.ayuda && <p className="text-xs text-slate-500">{p.ayuda}</p>}
            <div className="flex flex-wrap gap-1.5">
              {ESCALA_PROVEEDOR.map((e) => (
                <button
                  key={e.v}
                  type="button"
                  disabled={!editable}
                  onClick={() => setV((x) => ({ ...x, [p.id]: e.v }))}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${v[p.id] === e.v ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700"} disabled:cursor-default`}
                >
                  {e.v} · {e.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <label className="block space-y-1">
        <span className="block text-xs font-medium text-slate-600">Comentarios</span>
        <textarea value={c} onChange={(e) => setC(e.target.value)} disabled={!editable} rows={2} className={areaCls} placeholder={editable ? "Ej. un bulto llegó golpeado, faltaron 2 cajas..." : ""} />
      </label>
      {editable && (
        <div className="flex items-center gap-3">
          <Button loading={busy === "s"} disabled={faltan > 0} onClick={() => run("s", () => guardarEvalProveedorAction(evalId, v, c), "Evaluación guardada.")}>
            {cuando ? "Actualizar evaluación" : "Guardar evaluación"}
          </Button>
          {faltan > 0 && <span className="text-xs text-slate-500">Faltan {faltan} punto(s)</span>}
        </div>
      )}
    </Card>
  );
}
