"use client";

import { useState } from "react";
import { saveSacAction } from "@/actions/calidad";
import { areaCls, useRun } from "@/components/ops-ui";
import { Alert, Button, Input, Select } from "@/components/ui";
import type { SacValues } from "@/lib/ops/sac-values";
import { CLAUSULAS_ISO, FUENTES, SAC_ESTADOS, SEIS_M, type SacActividad, type SacEstado, type SacInput, type SacPersona, type SacVerificacion } from "@/lib/ops/calidad";

export type { SacValues } from "@/lib/ops/sac-values";

function H({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs text-white">{n}</span>
      {children}
    </h2>
  );
}
function L({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
function YesNo({ value, onChange, ro }: { value: boolean | null; onChange: (v: boolean | null) => void; ro: boolean }) {
  return (
    <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
      {([[true, "Sí"], [false, "No"]] as const).map(([v, l]) => (
        <button key={l} type="button" disabled={ro} onClick={() => onChange(value === v ? null : v)} className={`rounded px-3 py-1 ${value === v ? "bg-slate-800 text-white" : "text-slate-600"}`}>{l}</button>
      ))}
    </div>
  );
}

export function SacForm({ id, initial, readOnly, quejas, folio = null }: { id: string | null; initial: SacValues; readOnly: boolean; quejas: { id: string; numero: string; cliente_nombre: string }[]; folio?: string | null }) {
  // Una clausula capturada solo con el numero (ej. "8.5.1") se muestra con su nombre de la lista.
  const clausulaIni = CLAUSULAS_ISO.find((c) => c === initial.clausula.trim() || (!!initial.clausula.trim() && c.startsWith(`${initial.clausula.trim()} `))) ?? initial.clausula;
  const [v, setV] = useState<SacValues>({ ...initial, clausula: clausulaIni });
  const [otraClausula, setOtraClausula] = useState(!!clausulaIni && !(CLAUSULAS_ISO as readonly string[]).includes(clausulaIni));
  const { run, busy, notice, router } = useRun();
  const ro = readOnly;
  const t = (k: keyof SacValues) => ({
    value: (v[k] as string) ?? "",
    disabled: ro,
    onChange: (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value })),
  });
  const area = (k: keyof SacValues, rows = 2, ph = "") => <textarea {...t(k)} rows={rows} className={areaCls} placeholder={ro ? "" : ph} />;
  const setRow = <K extends "equipo" | "plan" | "verificacion">(k: K, i: number, patch: Partial<SacValues[K][number]>) =>
    setV((s) => ({ ...s, [k]: (s[k] as SacValues[K][number][]).map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRow = <K extends "equipo" | "plan" | "verificacion">(k: K, row: SacValues[K][number]) => setV((s) => ({ ...s, [k]: [...(s[k] as SacValues[K][number][]), row] }));
  const delRow = (k: "equipo" | "plan" | "verificacion", i: number) => setV((s) => ({ ...s, [k]: (s[k] as unknown[]).filter((_, j) => j !== i) }));
  const cell = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-50";

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        run("save", () => saveSacAction(id, v as unknown as SacInput), (r) => {
          if (id) {
            router.refresh();
          } else if (r.ok) router.push(`/calidad/sac/${r.id}`);
        });
      }}
    >
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <section className="space-y-3">
        <H n={1}>Datos generales</H>
        <div className="grid gap-3 sm:grid-cols-4">
          <L label="Fecha"><Input type="date" {...t("fecha")} /></L>
          <L label="Solicitante" className="sm:col-span-1"><Input {...t("solicitante")} /></L>
          <L label="Folio">
            <div className={`flex h-[38px] items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm ${folio ? "font-mono font-semibold text-slate-900" : "text-slate-500"}`}>
              {folio ?? "Se asigna al guardar"}
            </div>
          </L>
          <L label="Cláusula afectada (ISO 9001)">
            <Select
              disabled={ro}
              value={otraClausula ? "__otra" : v.clausula}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "__otra") {
                  setOtraClausula(true);
                  setV((s) => ({ ...s, clausula: "" }));
                } else {
                  setOtraClausula(false);
                  setV((s) => ({ ...s, clausula: val }));
                }
              }}
            >
              <option value="">Elige</option>
              {CLAUSULAS_ISO.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value="__otra">Otra (escribirla)</option>
            </Select>
            {otraClausula && <Input {...t("clausula")} placeholder="Ej. 8.3 Diseño y desarrollo" className="mt-1.5" maxLength={80} />}
          </L>
          <L label="Fuente de generación" className="sm:col-span-2">
            <Select {...t("fuente")}>
              <option value="">Elige</option>
              {Object.entries(FUENTES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </L>
          {v.fuente === "otro" && <L label="¿Cuál?"><Input {...t("fuente_otro")} /></L>}
          <L label="Queja de cliente ligada">
            <Select value={v.queja_id ?? ""} disabled={ro} onChange={(e) => setV((s) => ({ ...s, queja_id: e.target.value || null }))}>
              <option value="">Ninguna</option>
              {quejas.map((q) => <option key={q.id} value={q.id}>{q.numero} · {q.cliente_nombre}</option>)}
            </Select>
          </L>
        </div>
        <L label="Descripción del problema real o potencial">{area("descripcion", 3)}</L>
        <div className="space-y-2">
          <span className="block text-xs font-medium text-slate-600">Equipo (nombre y puesto)</span>
          {v.equipo.map((p, i) => (
            <div key={i} className="flex gap-2">
              <input className={cell} value={p.nombre} disabled={ro} placeholder="Nombre" onChange={(e) => setRow("equipo", i, { nombre: e.target.value })} />
              <input className={cell} value={p.puesto} disabled={ro} placeholder="Puesto" onChange={(e) => setRow("equipo", i, { puesto: e.target.value })} />
              {!ro && <button type="button" onClick={() => delRow("equipo", i)} className="px-2 text-slate-400 hover:text-red-600" aria-label="Quitar">×</button>}
            </div>
          ))}
          {!ro && <button type="button" onClick={() => addRow("equipo", { nombre: "", puesto: "" })} className="text-xs font-medium text-brand-700">+ Agregar persona</button>}
        </div>
      </section>

      <section className="space-y-3">
        <H n={2}>Reacción ante la no conformidad</H>
        <div className="grid gap-3 sm:grid-cols-3">
          <L label="Corrección">{area("correccion")}</L>
          <L label="Contención">{area("contencion")}</L>
          <L label="Consecuencia">{area("consecuencia")}</L>
        </div>
        <L label="Objetivo de la acción">{area("objetivo")}</L>
      </section>

      <section className="space-y-3">
        <H n={3}>Investigación causa y efecto (6M)</H>
        <div className="grid gap-3 sm:grid-cols-3">
          {SEIS_M.map(([k, l]) => (
            <L key={k} label={l}>
              <textarea value={v.causas[k] ?? ""} disabled={ro} rows={2} className={areaCls} onChange={(e) => setV((s) => ({ ...s, causas: { ...s.causas, [k]: e.target.value } }))} />
            </L>
          ))}
        </div>
        <L label="Causa raíz">{area("causa_raiz", 2)}</L>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <L label="¿En qué procesos o áreas se puede presentar la no conformidad?">{area("procesos_afectados", 2)}</L>
          <div className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">¿Actualizar riesgos y oportunidades?</span>
            <YesNo value={v.actualizar_riesgos} ro={ro} onChange={(x) => setV((s) => ({ ...s, actualizar_riesgos: x }))} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <H n={4}>Plan de acción</H>
        <div className="space-y-2">
          {v.plan.length === 0 && <p className="text-sm text-slate-500">Sin actividades.</p>}
          {v.plan.map((a, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[1fr_10rem_9rem_9rem_auto_auto] sm:items-center">
              <input className={cell} value={a.actividad} disabled={ro} placeholder="Actividad" onChange={(e) => setRow("plan", i, { actividad: e.target.value })} />
              <input className={cell} value={a.responsable} disabled={ro} placeholder="Responsable" onChange={(e) => setRow("plan", i, { responsable: e.target.value })} />
              <input className={cell} type="date" value={a.fecha} disabled={ro} title="Fecha" onChange={(e) => setRow("plan", i, { fecha: e.target.value })} />
              <input className={cell} type="date" value={a.reprogramacion} disabled={ro} title="Reprogramación" onChange={(e) => setRow("plan", i, { reprogramacion: e.target.value })} />
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={a.hecho} disabled={ro} onChange={(e) => setRow("plan", i, { hecho: e.target.checked })} /> Hecha</label>
              {!ro && <button type="button" onClick={() => delRow("plan", i)} className="px-2 text-slate-400 hover:text-red-600" aria-label="Quitar">×</button>}
            </div>
          ))}
          {!ro && <button type="button" onClick={() => addRow("plan", { actividad: "", responsable: "", fecha: "", reprogramacion: "", hecho: false })} className="text-xs font-medium text-brand-700">+ Agregar actividad</button>}
          <p className="text-[11px] text-slate-500">Columnas: actividad, responsable, fecha, fecha de reprogramación.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-xs font-medium text-slate-600">¿Las actividades pueden crear un problema o riesgo potencial en el sistema de gestión?</span>
          <YesNo value={v.plan_crea_riesgo} ro={ro} onChange={(x) => setV((s) => ({ ...s, plan_crea_riesgo: x }))} />
        </div>
        <L label="Observaciones">{area("plan_observaciones")}</L>
      </section>

      <section className="space-y-3">
        <H n={5}>Verificación del plan de acción</H>
        {v.verificacion.length === 0 && <p className="text-sm text-slate-500">Sin verificaciones.</p>}
        {v.verificacion.map((a, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[1fr_9rem_9rem_7rem_1fr_auto] sm:items-center">
            <input className={cell} value={a.actividad} disabled={ro} placeholder="Actividad" onChange={(e) => setRow("verificacion", i, { actividad: e.target.value })} />
            <input className={cell} value={a.auditor} disabled={ro} placeholder="Auditor" onChange={(e) => setRow("verificacion", i, { auditor: e.target.value })} />
            <input className={cell} type="date" value={a.fecha} disabled={ro} onChange={(e) => setRow("verificacion", i, { fecha: e.target.value })} />
            <select className={cell} value={a.cumple} disabled={ro} onChange={(e) => setRow("verificacion", i, { cumple: e.target.value as "" | "si" | "no" })}>
              <option value="">¿Cumple?</option><option value="si">Cumple</option><option value="no">No cumple</option>
            </select>
            <input className={cell} value={a.evidencia} disabled={ro} placeholder="Evidencia" onChange={(e) => setRow("verificacion", i, { evidencia: e.target.value })} />
            {!ro && <button type="button" onClick={() => delRow("verificacion", i)} className="px-2 text-slate-400 hover:text-red-600" aria-label="Quitar">×</button>}
          </div>
        ))}
        {!ro && <button type="button" onClick={() => addRow("verificacion", { actividad: "", auditor: "", fecha: "", cumple: "", evidencia: "" })} className="text-xs font-medium text-brand-700">+ Agregar verificación</button>}
      </section>

      <section className="space-y-3">
        <H n={6}>Efectividad y cierre</H>
        <L label="Observaciones de verificación de efectividad">{area("verificacion_observaciones")}</L>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-slate-600">¿Cumple el objetivo?</span>
          <YesNo value={v.cumple_objetivo} ro={ro} onChange={(x) => setV((s) => ({ ...s, cumple_objetivo: x }))} />
        </div>
        {v.cumple_objetivo === false && <L label="Si no cumple el objetivo, especificar alternativa">{area("alternativa")}</L>}
        <div className="grid gap-3 sm:grid-cols-3">
          <L label="Estatus">
            <Select {...t("estado")}>
              {Object.entries(SAC_ESTADOS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </Select>
          </L>
          <L label="Fecha de cierre"><Input type="date" {...t("fecha_cierre")} /></L>
        </div>
      </section>

      {!ro && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
          <Button type="submit" loading={busy === "save"}>{id ? "Guardar avance" : "Crear acción correctiva"}</Button>
        </div>
      )}
    </form>
  );
}
