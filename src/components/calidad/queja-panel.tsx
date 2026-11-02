"use client";

import Link from "next/link";
import { useState } from "react";
import { addCalidadCommentAction, quejaEstadoAction, uploadCalidadFileAction } from "@/actions/calidad";
import { QuejaForm } from "@/components/calidad/queja-form";
import { areaCls, FileUpload, Timeline, useRun, type TimelineEvent } from "@/components/ops-ui";
import { Alert, Button, Card } from "@/components/ui";
import { QUEJA_ESTADOS, type QuejaEstado } from "@/lib/ops/calidad";

export function QuejaPanel({
  q, role, canEdit, canWrite, events, files, form, today, sellers,
}: {
  q: { id: string; estado: QuejaEstado; solucion: string | null };
  role: string;
  canEdit: boolean;
  canWrite: boolean;
  events: TimelineEvent[];
  files: { id: string; nombre: string; url: string | null }[];
  form: Record<string, string | null>;
  today: string;
  sellers?: { id: string; nombre: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [estado, setEstado] = useState<QuejaEstado>(q.estado);
  const [solucion, setSolucion] = useState(q.solucion ?? "");
  const { run, busy, notice } = useRun();
  const iso = role === "coordinador_iso";
  return (
    <div className="space-y-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {iso && (
        <Card className="space-y-3 border-brand-100 bg-brand-50/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">Coordinador ISO</h2>
            <Link href={`/calidad/sac/nueva?queja=${q.id}`} className="rounded-md bg-purple-700 px-3 py-2 text-xs font-medium text-white hover:bg-purple-800">Crear acción correctiva</Link>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(QUEJA_ESTADOS) as QuejaEstado[]).map((k) => (
              <button key={k} type="button" onClick={() => setEstado(k)} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${estado === k ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                {QUEJA_ESTADOS[k].label}
              </button>
            ))}
          </div>
          <textarea value={solucion} onChange={(e) => setSolucion(e.target.value)} rows={3} className={areaCls} placeholder="Solución o respuesta al cliente (obligatoria para cerrar)" />
          <Button loading={busy === "st"} disabled={estado === q.estado && solucion === (q.solucion ?? "")} onClick={() => run("st", () => quejaEstadoAction(q.id, estado, solucion), "Queja actualizada.")}>Guardar estatus</Button>
        </Card>
      )}
      {canEdit && !editing && <Button variant="secondary" onClick={() => setEditing(true)}>Editar datos de la queja</Button>}
      {editing && (
        <Card className="p-4 sm:p-6"><QuejaForm id={q.id} initial={form} today={today} sellers={sellers} onDone={() => setEditing(false)} /></Card>
      )}
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Evidencias ({files.length})</h2>
        {files.length > 0 && (
          <ul className="space-y-1 text-sm">
            {files.map((f) => <li key={f.id}>{f.url ? <a href={f.url} className="text-brand-700 hover:underline">{f.nombre}</a> : f.nombre}</li>)}
          </ul>
        )}
        {canWrite && <FileUpload action={uploadCalidadFileAction} fields={{ kind: "queja", id: q.id }} accept="application/pdf,image/*,.xlsx,.docx" label="Subir evidencia" />}
      </Card>
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Seguimiento</h2>
        <Timeline events={events} onComment={canWrite ? (n) => addCalidadCommentAction({ queja_id: q.id }, n) : undefined} />
      </Card>
    </div>
  );
}
