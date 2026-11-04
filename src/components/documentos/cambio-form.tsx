"use client";

import { useState } from "react";
import { saveCambioAction } from "@/actions/documentos";
import { areaCls, useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { ESTADOS_CAMBIO, TIPOS_CAMBIO, type CambioRow, type EstadoCambio, type TipoCambio } from "@/lib/documentos";

export type DocOpcion = { id: string; codigo: string | null; titulo: string; version: string };

/** Control de cambios (version base, la llena el Coordinador ISO). */
export function CambioForm({ cambio, docs, today }: { cambio: CambioRow | null; docs: DocOpcion[]; today: string }) {
  const [v, setV] = useState({
    fecha: cambio?.fecha ?? today,
    tipo: (cambio?.tipo ?? "modificacion") as TipoCambio,
    documento_id: cambio?.documento_id ?? "",
    documento_texto: cambio?.documento_texto ?? "",
    area: cambio?.area ?? "",
    descripcion: cambio?.descripcion ?? "",
    motivo: cambio?.motivo ?? "",
    version_anterior: cambio?.version_anterior ?? "",
    version_nueva: cambio?.version_nueva ?? "",
    solicitado_por: cambio?.solicitado_por ?? "",
    aprobado_por: cambio?.aprobado_por ?? "",
    fecha_implementacion: cambio?.fecha_implementacion ?? "",
    estado: (cambio?.estado ?? "en_proceso") as EstadoCambio,
    notas: cambio?.notas ?? "",
  });
  const { run, busy, notice, router } = useRun();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const pickDoc = (id: string) => {
    const d = docs.find((x) => x.id === id);
    setV((s) => ({ ...s, documento_id: id, version_anterior: d && !s.version_anterior ? d.version : s.version_anterior }));
  };

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Fecha *"><Input type="date" value={v.fecha} onChange={set("fecha")} /></Field>
        <Field label="Tipo de cambio *">
          <Select value={v.tipo} onChange={set("tipo")}>{(Object.keys(TIPOS_CAMBIO) as TipoCambio[]).map((k) => <option key={k} value={k}>{TIPOS_CAMBIO[k]}</option>)}</Select>
        </Field>
        <Field label="Área o proceso"><Input value={v.area} onChange={set("area")} placeholder="Ej. Compras" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Documento (de la base de documentos)">
          <Select value={v.documento_id} onChange={(e) => pickDoc(e.target.value)}>
            <option value="">Ninguno / no está en la base</option>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.codigo ? `${d.codigo} ` : ""}{d.titulo} (v{d.version})</option>)}
          </Select>
        </Field>
        <Field label={v.documento_id ? "Referencia adicional" : "Documento o proceso que cambia *"}>
          <Input value={v.documento_texto} onChange={set("documento_texto")} placeholder="Ej. Procedimiento de compras internacionales" />
        </Field>
      </div>
      <Field label="Descripción del cambio *">
        <textarea value={v.descripcion} onChange={set("descripcion")} rows={3} className={areaCls} placeholder="Qué cambia exactamente" />
      </Field>
      <Field label="Motivo del cambio *">
        <textarea value={v.motivo} onChange={set("motivo")} rows={2} className={areaCls} placeholder="Ej. Hallazgo de auditoría, mejora, cambio de proceso" />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Versión anterior"><Input value={v.version_anterior} onChange={set("version_anterior")} placeholder="01" /></Field>
        <Field label="Versión nueva"><Input value={v.version_nueva} onChange={set("version_nueva")} placeholder="02" /></Field>
        <Field label="Solicitado por"><Input value={v.solicitado_por} onChange={set("solicitado_por")} /></Field>
        <Field label="Aprobado por"><Input value={v.aprobado_por} onChange={set("aprobado_por")} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Estado">
          <Select value={v.estado} onChange={set("estado")}>{(Object.keys(ESTADOS_CAMBIO) as EstadoCambio[]).map((k) => <option key={k} value={k}>{ESTADOS_CAMBIO[k].label}</option>)}</Select>
        </Field>
        <Field label="Fecha de implementación"><Input type="date" value={v.fecha_implementacion} onChange={set("fecha_implementacion")} /></Field>
      </div>
      <Field label="Notas">
        <textarea value={v.notas} onChange={set("notas")} rows={2} className={areaCls} />
      </Field>
      <div className="flex gap-2">
        <Button loading={busy === "s"} onClick={() => run("s", () => saveCambioAction(cambio?.id ?? null, v), (r) => { if (r.ok) { router.push(`/calidad/cambios/${r.id}`); router.refresh(); } })}>
          {cambio ? "Guardar cambios" : "Registrar cambio"}
        </Button>
      </div>
    </Card>
  );
}
