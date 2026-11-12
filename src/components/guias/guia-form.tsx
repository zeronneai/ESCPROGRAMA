"use client";

import { useState } from "react";
import { saveGuiaAction } from "@/actions/guias";
import { areaCls, CustomerLookup, useRun } from "@/components/ops-ui";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { PAQUETERIAS, SERVICIOS, guiaTitle, resumenPartidas, type GuiaInput } from "@/lib/ops/guias";
import { ESTADOS_MX } from "@/lib/validation/customer";

type F = Record<Exclude<keyof GuiaInput, "partidas">, string | boolean | null>;
const EMPTY: F = {
  factura: "", destinatario: "", paqueteria: "", paqueteria_otra: "", servicio: "estandar", customer_id: null, contacto_nombre: "",
  telefono: "", correo: "", calle_numero: "", colonia: "", cp: "", ciudad: "", estado_geo: "", referencias: "",
  contenido: "", valor_declarado: "", asegurar: false, urgente: false, notas: "",
};
/** Partida en el formulario (texto mientras se escribe). */
export type PartidaForm = { key: string; empaque: "bulto" | "tarima"; cantidad: string; peso_kg: string; largo_cm: string; ancho_cm: string; alto_cm: string; descripcion: string };
const nuevaPartida = (empaque: "bulto" | "tarima" = "bulto"): PartidaForm => ({
  key: Math.random().toString(36).slice(2), empaque, cantidad: "1", peso_kg: "", largo_cm: "", ancho_cm: "", alto_cm: "", descripcion: "",
});
const numero = (x: string) => Number(x.replace(",", "."));

export function GuiaForm({ id, initial, partidas: iniciales, onDone }: { id: string | null; initial?: Partial<F>; partidas?: PartidaForm[]; onDone?: () => void }) {
  const [v, setV] = useState<F>({ ...EMPTY, ...initial });
  const [ps, setPs] = useState<PartidaForm[]>(iniciales?.length ? iniciales : [nuevaPartida()]);
  const setP = (i: number, k: keyof PartidaForm, val: string) => setPs((a) => a.map((p, j) => (j === i ? { ...p, [k]: val } : p)));
  const validas = ps.filter((p) => numero(p.cantidad) > 0);
  const totPeso = validas.reduce((a, p) => a + (numero(p.cantidad) || 0) * (numero(p.peso_kg) || 0), 0);
  const resumen = resumenPartidas(validas.map((p) => ({ empaque: p.empaque, cantidad: Math.floor(numero(p.cantidad)) || 0 })));
  const { run, busy, notice, router } = useRun();
  const set = (k: keyof F) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const s = (k: keyof F) => (v[k] ?? "") as string;
  const title = v.factura || v.destinatario || v.paqueteria ? guiaTitle({ factura: s("factura") || "Factura", destinatario: s("destinatario") || "Destinatario", paqueteria: s("paqueteria") || "Paquetería", paqueteria_otra: s("paqueteria_otra") }) : null;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const datos = { ...v, partidas: ps.map(({ key: _k, ...p }) => p) } as unknown as GuiaInput;
        run("save", () => saveGuiaAction(id, datos), (r) => {
          if (onDone) {
            onDone();
            router.refresh();
          } else router.push(`/guias/${r.ok ? r.id : ""}`);
        });
      }}
    >
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {title && <p className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">Título: {title}</p>}

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <Field label="Factura *"><Input value={s("factura")} onChange={set("factura")} placeholder="Ej. A-1234" /></Field>
        <Field label="Paquetería *">
          <Select value={s("paqueteria")} onChange={set("paqueteria")}>
            <option value="">Elige</option>
            {PAQUETERIAS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        {v.paqueteria === "Otra" ? (
          <Field label="¿Cuál? *"><Input value={s("paqueteria_otra")} onChange={set("paqueteria_otra")} /></Field>
        ) : (
          <Field label="Servicio">
            <Select value={s("servicio")} onChange={set("servicio")}>
              {Object.entries(SERVICIOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
        )}
      </fieldset>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Destinatario</h3>
        <CustomerLookup
          onPick={(c) =>
            setV((x) => ({
              ...x,
              customer_id: c.id,
              destinatario: c.nombre,
              contacto_nombre: c.contacto_nombre ?? x.contacto_nombre,
              telefono: c.contacto_telefono ?? x.telefono,
              correo: c.contacto_correo ?? x.correo,
              calle_numero: c.direccion ?? x.calle_numero,
              estado_geo: c.estado_geo ?? x.estado_geo,
            }))
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Persona o negocio *"><Input value={s("destinatario")} onChange={set("destinatario")} /></Field>
          <Field label="Recibe (nombre)"><Input value={s("contacto_nombre")} onChange={set("contacto_nombre")} /></Field>
          <Field label="Teléfono *"><Input value={s("telefono")} onChange={set("telefono")} inputMode="tel" /></Field>
          <Field label="Correo"><Input value={s("correo")} onChange={set("correo")} type="email" /></Field>
          <div className="sm:col-span-2"><Field label="Calle y número *"><Input value={s("calle_numero")} onChange={set("calle_numero")} /></Field></div>
          <Field label="Colonia"><Input value={s("colonia")} onChange={set("colonia")} /></Field>
          <Field label="Código postal *"><Input value={s("cp")} onChange={set("cp")} inputMode="numeric" maxLength={5} /></Field>
          <Field label="Ciudad *"><Input value={s("ciudad")} onChange={set("ciudad")} /></Field>
          <Field label="Estado *">
            <Select value={s("estado_geo")} onChange={set("estado_geo")}>
              <option value="">Elige</option>
              {ESTADOS_MX.map((e) => <option key={e} value={e}>{e}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2"><Field label="Referencias del domicilio"><Input value={s("referencias")} onChange={set("referencias")} placeholder="Entre calles, color de fachada, horario de recepción" /></Field></div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Paquete</h3>
        <p className="text-xs text-slate-500">Agrega una partida por cada tipo distinto: por ejemplo, una tarima de 1.20 m y otra de 1 m van en partidas separadas. El peso y las medidas son de cada pieza.</p>
        <div className="space-y-3">
          {ps.map((p, i) => (
            <div key={p.key} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">Partida {i + 1}</span>
                <div className="flex items-center gap-2">
                  <div className="inline-flex overflow-hidden rounded-md border border-slate-300 bg-white text-sm">
                    {(["bulto", "tarima"] as const).map((k) => (
                      <button key={k} type="button" onClick={() => setP(i, "empaque", k)}
                        className={`px-3 py-1.5 font-medium ${p.empaque === k ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}>
                        {k === "bulto" ? "Bultos" : "Tarima"}
                      </button>
                    ))}
                  </div>
                  {ps.length > 1 && (
                    <button type="button" onClick={() => setPs((a) => a.filter((_, j) => j !== i))} className="rounded-md px-2 py-1 text-sm text-red-700 hover:bg-red-50">Quitar</button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Field label={p.empaque === "tarima" ? "Tarimas *" : "Bultos *"}><Input value={p.cantidad} onChange={(e) => setP(i, "cantidad", e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" /></Field>
                <Field label={`Peso de c/u kg *`}><Input value={p.peso_kg} onChange={(e) => setP(i, "peso_kg", e.target.value)} inputMode="decimal" /></Field>
                <Field label="Largo cm"><Input value={p.largo_cm} onChange={(e) => setP(i, "largo_cm", e.target.value)} inputMode="decimal" /></Field>
                <Field label="Ancho cm"><Input value={p.ancho_cm} onChange={(e) => setP(i, "ancho_cm", e.target.value)} inputMode="decimal" /></Field>
                <Field label="Alto cm"><Input value={p.alto_cm} onChange={(e) => setP(i, "alto_cm", e.target.value)} inputMode="decimal" /></Field>
              </div>
              <Field label="Qué lleva (opcional)"><Input value={p.descripcion} onChange={(e) => setP(i, "descripcion", e.target.value)} maxLength={150} placeholder={p.empaque === "tarima" ? "Ej. Tarima con 40 cajas de guantes" : "Ej. Cajas de batas ESD"} /></Field>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="secondary" disabled={ps.length >= 30} onClick={() => setPs((a) => [...a, nuevaPartida(a[a.length - 1]?.empaque ?? "bulto")])}>+ Agregar partida</Button>
          {resumen && <span className="text-sm font-medium text-slate-700">Total: {resumen}{totPeso > 0 ? ` · ${Math.round(totPeso * 100) / 100} kg` : ""}</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contenido general"><Input value={s("contenido")} onChange={set("contenido")} placeholder="Ej. 10 cajas de guantes de nitrilo" /></Field>
          <Field label="Valor declarado (MXN)"><Input value={s("valor_declarado")} onChange={set("valor_declarado")} inputMode="decimal" /></Field>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={!!v.asegurar} onChange={(e) => setV((x) => ({ ...x, asegurar: e.target.checked }))} /> <span>Asegurar el envío<span className="block text-xs text-slate-500">Si se pierde o llega dañado, la paquetería paga el valor declarado. Tiene costo extra.</span></span></label>
          <label className="flex items-center gap-2 font-medium text-red-700"><input type="checkbox" checked={!!v.urgente} onChange={(e) => setV((x) => ({ ...x, urgente: e.target.checked }))} /> Es urgente</label>
        </div>
        <Field label="Notas para Marketplaces">
          <textarea value={s("notas")} onChange={set("notas")} rows={2} className={areaCls} placeholder="Recolección, horario, instrucciones especiales" />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy === "save"}>{id ? "Guardar cambios" : "Solicitar guía"}</Button>
        {onDone && <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>}
      </div>
    </form>
  );
}
