"use client";

import { useRef, useState } from "react";
import { cancelarGuiaAction, commentGuiaAction, pedirDatosGuiaAction, quitarArchivoGuiaAction, recordarGuiaAction, subirGuiaAction, tomarGuiaAction } from "@/actions/guias";
import { GuiaForm, type PartidaForm } from "@/components/guias/guia-form";
import { Icon } from "@/components/icons";
import { areaCls, Timeline, useRun, type TimelineEvent } from "@/components/ops-ui";
import { Alert, Button, Card, Input } from "@/components/ui";
import { canRemind, type GuiaEstado } from "@/lib/ops/guias";

export interface GuiaPanelData {
  id: string;
  estado: GuiaEstado;
  solicitada_at: string;
  ultimo_recordatorio_at: string | null;
  mensaje: string | null;
  /** Archivos de guia (uno por bulto o tarima); url null para el vendedor. */
  archivos: { nombre: string; rastreo: string | null; bulto: string | null; url: string | null }[];
  /** true cuando ya corrio la 0054 (se pueden subir varios archivos). */
  varios: boolean;
  numero_rastreo: string | null;
  atendida_nombre: string | null;
  form: Record<string, string | boolean | null>;
  partidas: PartidaForm[];
}

export function GuiaPanel({ g, role, isOwner, events }: { g: GuiaPanelData; role: string; isOwner: boolean; events: TimelineEvent[] }) {
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const [rastreo, setRastreo] = useState(g.varios ? "" : g.numero_rastreo ?? "");
  const [bulto, setBulto] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

      {(g.archivos.length > 0 || g.estado === "lista") && (
        <Card className="space-y-3 border-green-300 bg-green-50">
          <p className="text-sm font-semibold text-green-900">
            {g.archivos.length > 1 ? `La guía está lista: ${g.archivos.length} guías (una por bulto o tarima)` : "La guía está lista"}
          </p>
          {g.archivos.length === 0 && <p className="text-sm text-green-900">{g.numero_rastreo ? <>Número de guía: <span className="select-all font-mono text-base font-semibold">{g.numero_rastreo}</span></> : "Marketplaces todavía no captura el número de guía."}</p>}
          {g.archivos.map((a, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg border border-green-200 bg-white/70 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm text-green-900">
                {g.archivos.length > 1 && <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Guía {i + 1}{a.bulto ? ` · ${a.bulto}` : ""}</p>}
                {g.archivos.length === 1 && a.bulto && <p className="text-xs font-semibold uppercase tracking-wide text-green-700">{a.bulto}</p>}
                {a.rastreo ? (
                  <p>Número de guía: <span className="select-all font-mono text-base font-semibold">{a.rastreo}</span></p>
                ) : (
                  <p className="truncate">{a.nombre}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {a.url && <a href={a.url} className="inline-flex items-center justify-center gap-2 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800">
                  <Icon name="download" className="h-4 w-4" /> Descargar{g.archivos.length > 1 ? ` guía ${i + 1}` : " guía"}
                </a>}
                {isMkt && g.varios && (
                  <Button
                    variant="ghost"
                    className="text-xs text-red-700"
                    loading={busy === `quitar${i}`}
                    onClick={() => {
                      if (window.confirm(`¿Quitar la guía ${a.rastreo ?? a.nombre}?`)) run(`quitar${i}`, () => quitarArchivoGuiaAction(g.id, i), "Guía quitada.");
                    }}
                  >
                    Quitar
                  </Button>
                )}
              </div>
            </div>
          ))}
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
              <p className="text-xs text-slate-600">
                {g.varios
                  ? g.archivos.length
                    ? "¿La paquetería generó otra guía (otro bulto o tarima)? Súbela aquí con su número."
                    : "Sube la guía (PDF o imagen) con su número. Si la paquetería genera una guía por bulto o tarima, sube un archivo por cada uno."
                  : g.estado === "lista" ? "Reemplazar el archivo de la guía" : "Sube la guía (PDF o imagen) y escribe el número de guía"}
              </p>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                <Input value={rastreo} onChange={(e) => setRastreo(e.target.value)} placeholder="Número de guía *" />
                {g.varios && (
                  <>
                    <Input value={bulto} onChange={(e) => setBulto(e.target.value)} placeholder="¿Para qué bulto o tarima? (opcional)" list={`bultos-${g.id}`} maxLength={80} />
                    <datalist id={`bultos-${g.id}`}>{opcionesBulto(g.partidas).map((o) => <option key={o} value={o} />)}</datalist>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-400 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  <Icon name="download" className="h-4 w-4 rotate-180" />
                  <span className="max-w-[14rem] truncate">{archivo?.name || "Elegir archivo"}</span>
                  <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
                </label>
                <Button
                  loading={busy === "subir"}
                  disabled={!archivo}
                  onClick={() =>
                    run("subir", async () => {
                      const fd = new FormData();
                      fd.set("id", g.id);
                      fd.set("rastreo", rastreo);
                      fd.set("bulto", bulto);
                      if (archivo) fd.set("file", archivo);
                      const r = await subirGuiaAction(fd);
                      if (r.ok && g.varios) {
                        setRastreo("");
                        setBulto("");
                        setArchivo(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }
                      return r;
                    }, g.varios && g.archivos.length ? "Guía agregada." : "Guía subida.")
                  }
                >
                  {g.varios && g.archivos.length ? "Agregar otra guía" : "Subir guía"}
                </Button>
              </div>
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

/** Sugerencias para "¿para qué bulto o tarima?" a partir de las partidas que pidio el vendedor. */
function opcionesBulto(partidas: PartidaForm[]): string[] {
  const out: string[] = [];
  const cuenta = { bulto: 0, tarima: 0 };
  for (const p of partidas) {
    const n = Math.min(Math.max(Math.round(Number(p.cantidad) || 1), 1), 20);
    const peso = Number(p.peso_kg) > 0 ? ` · ${Number(p.peso_kg)} kg` : "";
    for (let k = 0; k < n; k++) {
      cuenta[p.empaque] += 1;
      out.push(`${p.empaque === "tarima" ? "Tarima" : "Bulto"} ${cuenta[p.empaque]}${peso}`);
    }
  }
  return [...out, "Todo el envío"].slice(0, 40);
}
