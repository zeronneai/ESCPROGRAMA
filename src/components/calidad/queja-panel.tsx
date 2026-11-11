"use client";

import Link from "next/link";
import { useState } from "react";
import { addCalidadCommentAction, quejaDictamenAction, quejaEstadoAction, uploadCalidadFileAction } from "@/actions/calidad";
import { QuejaForm } from "@/components/calidad/queja-form";
import { areaCls, FileUpload, Timeline, useRun, type TimelineEvent } from "@/components/ops-ui";
import { Alert, Button, Card, Select } from "@/components/ui";
import { QUEJA_ESTADOS, QUEJA_ESTADOS_MANUALES, quejaBloqueada, type QuejaEstado } from "@/lib/ops/calidad";

export function QuejaPanel({
  q, role, canEdit, canWrite, events, files, form, today, sellers,
}: {
  q: { id: string; estado: QuejaEstado; solucion: string | null; vendedor_id: string | null };
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
  const [nota, setNota] = useState("");
  const [vend, setVend] = useState(q.vendedor_id ?? "");
  const { run, busy, notice } = useRun();
  const iso = role === "coordinador_iso";
  const bloqueada = quejaBloqueada(q.estado);
  const dictaminar = (aplica: boolean) =>
    run(aplica ? "si" : "no", () => quejaDictamenAction(q.id, aplica, nota, vend || null), aplica ? "Listo: la queja aplica y ya puedes darle seguimiento." : "Marcada como que no aplica.");
  return (
    <div className="space-y-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {iso && bloqueada && (
        <div className={`space-y-3 rounded-xl border p-4 shadow-sm ${q.estado === "por_revisar" ? "border-orange-300 bg-orange-50" : "border-slate-200 bg-slate-50"}`}>
          <div>
            <h2 className="text-base font-semibold text-slate-900">{q.estado === "por_revisar" ? "¿Esta queja aplica?" : "Marcaste que esta queja no aplica"}</h2>
            <p className="text-sm text-slate-600">
              {q.estado === "por_revisar"
                ? "Revisa lo que mandaron. Si aplica, se desbloquea todo: estatus, acción correctiva, comentarios y evidencias."
                : "Si lo reconsideras, márcala como que sí aplica y se desbloquea el seguimiento."}
            </p>
          </div>
          {sellers && (
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Vendedor que la atiende (opcional)</span>
              <Select value={vend} onChange={(e) => setVend(e.target.value)} className="mt-1">
                <option value="">Sin vendedor</option>
                {sellers.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </Select>
            </label>
          )}
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} className={areaCls}
            placeholder={q.estado === "por_revisar" ? "Comentario (obligatorio si no aplica: explica por qué)" : "Comentario (opcional)"} />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!busy} onClick={() => dictaminar(true)}
              className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 active:scale-[0.98] disabled:opacity-50">
              {busy === "si" ? "Guardando..." : "Sí aplica"}
            </button>
            {q.estado === "por_revisar" && (
              <Button variant="secondary" loading={busy === "no"} disabled={!!busy} onClick={() => dictaminar(false)}>No aplica</Button>
            )}
          </div>
        </div>
      )}
      {!iso && bloqueada && (
        <Alert tone="info">
          {q.estado === "por_revisar"
            ? "El coordinador ISO está revisando si esta queja aplica. Cuando la acepte podrás comentar y subir evidencias."
            : "El coordinador ISO marcó que esta queja no aplica."}
        </Alert>
      )}
      {iso && !bloqueada && (
        <Card className="space-y-3 border-brand-100 bg-brand-50/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">Coordinador ISO</h2>
            <Link href={`/calidad/sac/nueva?queja=${q.id}`} className="rounded-md bg-purple-700 px-3 py-2 text-xs font-medium text-white hover:bg-purple-800">Crear acción correctiva</Link>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUEJA_ESTADOS_MANUALES.map((k) => (
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
