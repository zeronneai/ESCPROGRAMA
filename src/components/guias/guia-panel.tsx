"use client";

import { useState } from "react";
import { cancelarGuiaAction, commentGuiaAction, pedirDatosGuiaAction, recordarGuiaAction, subirGuiaAction, tomarGuiaAction } from "@/actions/guias";
import { GuiaForm, type PartidaForm } from "@/components/guias/guia-form";
import { Icon } from "@/components/icons";
import { areaCls, FileUpload, Timeline, useRun, type TimelineEvent } from "@/components/ops-ui";
import { Alert, Button, Card, Input } from "@/components/ui";
import { canRemind, type GuiaEstado } from "@/lib/ops/guias";

export interface GuiaPanelData {
  id: string;
  estado: GuiaEstado;
  solicitada_at: string;
  ultimo_recordatorio_at: string | null;
  mensaje: string | null;
  archivo_url: string | null;
  archivo_nombre: string | null;
  numero_rastreo: string | null;
  atendida_nombre: string | null;
  form: Record<string, string | boolean | null>;
  partidas: PartidaForm[];
}

export function GuiaPanel({ g, role, isOwner, events }: { g: GuiaPanelData; role: string; isOwner: boolean; events: TimelineEvent[] }) {
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const [rastreo, setRastreo] = useState(g.numero_rastreo ?? "");
  const [askData, setAskData] = useState(false);
  const { run, busy, notice } = useRun();
  const isMkt = role === "marketplaces";
  const remind = canRemind(g, new Date());
  const pending = g.estado === "solicitada" || g.estado === "en_proceso";

  return (
    <div className="space-y-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {g.estado === "requiere_datos" && (
        <Card className="border-red-300 bg-red-50">
          <p className="text-sm font-semibold text-red-900">Marketplaces necesita datos para generar la guía</p>
          <p className="mt-1 whitespace-pre-line text-sm text-red-900">{g.mensaje}</p>
          {isOwner && !editing && <Button className="mt-3" onClick={() => setEditing(true)}>Corregir datos</Button>}
        </Card>
      )}

      {(g.archivo_url || g.estado === "lista") && (
        <Card className="flex flex-col gap-3 border-green-300 bg-green-50 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-green-900">
            <p className="font-semibold">La guía está lista</p>
            {g.numero_rastreo ? (
              <p>Número de guía: <span className="select-all font-mono text-base font-semibold">{g.numero_rastreo}</span></p>
            ) : (
              <p>{g.archivo_url ? g.archivo_nombre : "Marketplaces todavía no captura el número de guía."}</p>
            )}
          </div>
          {g.archivo_url && <a href={g.archivo_url} className="inline-flex items-center justify-center gap-2 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800">
            <Icon name="download" className="h-4 w-4" /> Descargar guía
          </a>}
        </Card>
      )}

      {/* Vendedor */}
      {isOwner && !editing && (pending || g.estado === "requiere_datos") && (
        <div className="flex flex-wrap items-center gap-2">
          {pending && (
            <Button variant={remind.ok ? "primary" : "secondary"} disabled={!remind.ok} loading={busy === "rem"} onClick={() => run("rem", () => recordarGuiaAction(g.id), "Recordatorio enviado a Marketplaces.")}>
              <Icon name="bell" className="h-4 w-4" /> Recordar a Marketplaces
            </Button>
          )}
          {pending && !remind.ok && <span className="text-xs text-slate-500">{remind.reason}</span>}
          {g.estado === "solicitada" && <Button variant="secondary" onClick={() => setEditing(true)}>Editar datos</Button>}
          <Button
            variant="ghost"
            className="ml-auto text-xs text-red-700"
            loading={busy === "cancel"}
            onClick={() => {
              if (window.confirm("¿Cancelar esta guía?")) run("cancel", () => cancelarGuiaAction(g.id, ""), "Guía cancelada.");
            }}
          >
            Cancelar guía
          </Button>
        </div>
      )}
      {isOwner && editing && (
        <Card className="p-4 sm:p-6">
          <GuiaForm id={g.id} initial={g.form} partidas={g.partidas} onDone={() => setEditing(false)} />
        </Card>
      )}

      {/* Marketplaces */}
      {isMkt && g.estado !== "cancelada" && (
        <Card className="space-y-3 border-brand-100 bg-brand-50/40">
          <h2 className="text-sm font-semibold text-slate-800">Atender guía</h2>
          {g.estado === "solicitada" && (
            <Button loading={busy === "tomar"} onClick={() => run("tomar", () => tomarGuiaAction(g.id), "Guía tomada. El vendedor ve que ya la estás generando.")}>Tomar y generar</Button>
          )}
          {g.estado !== "requiere_datos" && (
            <div className="space-y-2">
              <p className="text-xs text-slate-600">{g.estado === "lista" ? "Reemplazar el archivo de la guía" : "Sube la guía (PDF o imagen) y escribe el número de guía"}</p>
              <Input value={rastreo} onChange={(e) => setRastreo(e.target.value)} placeholder="Número de guía *" className="sm:w-72!" />
              <FileUpload action={subirGuiaAction} fields={{ id: g.id }} accept="application/pdf,image/png,image/jpeg" label="Subir guía" extra={(fd) => fd.set("rastreo", rastreo)} />
            </div>
          )}
          {(g.estado === "solicitada" || g.estado === "en_proceso") && (
            askData ? (
              <div className="space-y-2">
                <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} className={areaCls} placeholder="¿Qué dato falta o está mal?" />
                <div className="flex gap-2">
                  <Button variant="danger" loading={busy === "datos"} onClick={() => run("datos", () => pedirDatosGuiaAction(g.id, msg), "Se le pidió al vendedor que corrija.")}>Pedir datos al vendedor</Button>
                  <Button variant="ghost" onClick={() => setAskData(false)}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setAskData(true)}>Faltan datos</Button>
            )
          )}
          {g.estado === "requiere_datos" && <p className="text-sm text-slate-600">Esperando que el vendedor corrija los datos.</p>}
        </Card>
      )}

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Seguimiento y mensajes</h2>
        <Timeline events={events} onComment={isOwner || isMkt ? (n) => commentGuiaAction(g.id, n) : undefined} placeholder={isMkt ? "Mensaje para el vendedor" : "Mensaje para Marketplaces"} />
      </Card>
    </div>
  );
}
