"use client";

import { useState } from "react";
import { aprobarConsumoAction, avanceConsumoAction, cancelarConsumoAction, commentConsumoAction } from "@/actions/consumo";
import { ConsumoForm } from "@/components/consumo/consumo-form";
import { areaCls, Timeline, useRun, type TimelineEvent } from "@/components/ops-ui";
import { Alert, Button, Card, Input } from "@/components/ui";
import { avanceLabel, type ConsumoEstado } from "@/lib/ops/consumo";

export function ConsumoPanel({
  c,
  role,
  isOwner,
  events,
  form,
}: {
  c: { id: string; estado: ConsumoEstado; tipo: "producto" | "servicio"; fecha_programada: string | null };
  role: string;
  isOwner: boolean;
  events: TimelineEvent[];
  form: Record<string, string | boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [nota, setNota] = useState("");
  const [fecha, setFecha] = useState(c.fecha_programada ?? "");
  const { run, busy, notice } = useRun();
  const canComment = isOwner || role === "jefe_ventas" || role === "comprador";

  return (
    <div className="space-y-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {role === "jefe_ventas" && c.estado === "por_aprobar" && (
        <Card className="space-y-3 border-amber-200 bg-amber-50">
          <h2 className="text-sm font-semibold text-amber-900">¿Apruebas esta solicitud?</h2>
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} className={areaCls} placeholder="Comentario (obligatorio si la rechazas)" />
          <div className="flex flex-wrap gap-2">
            <Button className="bg-green-600 hover:bg-green-700" loading={busy === "si"} onClick={() => run("si", () => aprobarConsumoAction(c.id, true, nota), "Aprobada. El comprador ya la puede ver.")}>Aprobar</Button>
            <Button variant="danger" loading={busy === "no"} onClick={() => run("no", () => aprobarConsumoAction(c.id, false, nota), "Rechazada.")}>Rechazar</Button>
          </div>
        </Card>
      )}

      {role === "comprador" && (c.estado === "aprobada" || c.estado === "en_proceso") && (
        <Card className="space-y-3 border-brand-100 bg-brand-50/40">
          <h2 className="text-sm font-semibold text-slate-800">Seguimiento de compras</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs text-slate-600">
              <span className="block">{c.tipo === "servicio" ? "Fecha agendada" : "Fecha estimada de llegada"}</span>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-44!" />
            </label>
            <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (proveedor, taller, folio de pedido)" className="sm:w-80!" />
          </div>
          <div className="flex flex-wrap gap-2">
            {c.estado === "aprobada" && (
              <Button loading={busy === "proc"} onClick={() => run("proc", () => avanceConsumoAction(c.id, "en_proceso", fecha, nota), "Marcado. Quien la pidió ya lo ve.")}>
                Marcar {avanceLabel(c.tipo, "en_proceso").toLowerCase()}
              </Button>
            )}
            {c.estado === "en_proceso" && fecha !== (c.fecha_programada ?? "") && (
              <Button variant="secondary" loading={busy === "proc"} onClick={() => run("proc", () => avanceConsumoAction(c.id, "en_proceso", fecha, nota), "Fecha actualizada.")}>Actualizar fecha</Button>
            )}
            <Button className="bg-green-600 hover:bg-green-700" loading={busy === "ok"} onClick={() => run("ok", () => avanceConsumoAction(c.id, "completada", fecha, nota), "Completada.")}>
              Marcar {avanceLabel(c.tipo, "completada").toLowerCase()}
            </Button>
            <Button variant="ghost" className="ml-auto text-xs text-red-700" loading={busy === "x"} onClick={() => { if (window.confirm("¿Cancelar esta solicitud?")) run("x", () => cancelarConsumoAction(c.id, nota), "Cancelada."); }}>Cancelar</Button>
          </div>
        </Card>
      )}

      {isOwner && c.estado === "por_aprobar" && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>Editar</Button>
          <Button variant="ghost" className="text-red-700" loading={busy === "x"} onClick={() => { if (window.confirm("¿Cancelar esta solicitud?")) run("x", () => cancelarConsumoAction(c.id, ""), "Cancelada."); }}>Cancelar solicitud</Button>
        </div>
      )}
      {isOwner && c.estado === "aprobada" && role !== "comprador" && (
        <Button variant="ghost" className="text-red-700" loading={busy === "x"} onClick={() => { if (window.confirm("¿Cancelar esta solicitud?")) run("x", () => cancelarConsumoAction(c.id, ""), "Cancelada."); }}>Ya no la necesito, cancelar</Button>
      )}
      {editing && (
        <Card className="p-4 sm:p-6"><ConsumoForm id={c.id} initial={form} onDone={() => setEditing(false)} /></Card>
      )}

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Seguimiento</h2>
        <Timeline events={events} onComment={canComment ? (n) => commentConsumoAction(c.id, n) : undefined} />
      </Card>
    </div>
  );
}
