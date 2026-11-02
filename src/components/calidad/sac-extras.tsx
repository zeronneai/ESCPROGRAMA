"use client";

import { FileUpload, Timeline, type TimelineEvent } from "@/components/ops-ui";
import { Card } from "@/components/ui";
import type { Result } from "@/actions/requests";

export function SacExtras({
  id, iso, files, events, upload, comment,
}: {
  id: string;
  iso: boolean;
  files: { id: string; nombre: string; url: string | null }[];
  events: TimelineEvent[];
  upload: (fd: FormData) => Promise<Result>;
  comment: (ref: { sac_id: string }, nota: string) => Promise<Result>;
}) {
  return (
    <>
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Evidencias ({files.length})</h2>
        {files.length > 0 && (
          <ul className="space-y-1 text-sm">
            {files.map((f) => <li key={f.id}>{f.url ? <a href={f.url} className="text-brand-700 hover:underline">{f.nombre}</a> : f.nombre}</li>)}
          </ul>
        )}
        {iso && <FileUpload action={upload} fields={{ kind: "sac", id }} accept="application/pdf,image/*,.xlsx,.docx" label="Subir evidencia" />}
        {!iso && files.length === 0 && <p className="text-sm text-slate-500">Sin evidencias.</p>}
      </Card>
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Seguimiento</h2>
        <Timeline events={events} onComment={iso ? (n) => comment({ sac_id: id }, n) : undefined} />
      </Card>
    </>
  );
}
