"use client";

import { useState } from "react";
import { saveGuiaAction } from "@/actions/guias";
import { areaCls, CustomerLookup, useRun } from "@/components/ops-ui";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { PAQUETERIAS, SERVICIOS, guiaTitle, type GuiaInput } from "@/lib/ops/guias";
import { ESTADOS_MX } from "@/lib/validation/customer";

type F = Record<keyof GuiaInput, string | boolean | null>;
const EMPTY: F = {
  factura: "", destinatario: "", paqueteria: "", paqueteria_otra: "", servicio: "estandar", customer_id: null, contacto_nombre: "",
  telefono: "", correo: "", calle_numero: "", colonia: "", cp: "", ciudad: "", estado_geo: "", referencias: "", empaque: "bulto", bultos: "1",
  peso_kg: "", largo_cm: "", ancho_cm: "", alto_cm: "", contenido: "", valor_declarado: "", asegurar: false, urgente: false, notas: "",
};

export function GuiaForm({ id, initial, onDone }: { id: string | null; initial?: Partial<F>; onDone?: () => void }) {
  const [v, setV] = useState<F>({ ...EMPTY, ...initial });
  const { run, busy, notice, router } = useRun();
  const set = (k: keyof F) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const s = (k: keyof F) => (v[k] ?? "") as string;
  const title = v.factura || v.destinatario || v.paqueteria ? guiaTitle({ factura: s("factura") || "Factura", destinatario: s("destinatario") || "Destinatario", paqueteria: s("paqueteria") || "Paquetería", paqueteria_otra: s("paqueteria_otra") }) : null;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        run("save", () => saveGuiaAction(id, v as unknown as GuiaInput), (r) => {
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
        <div className="space-y-1">
          <span className="block text-sm font-medium text-slate-700">¿Cómo se manda? *</span>
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            {(["bulto", "tarima"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setV((x) => ({ ...x, empaque: k }))}
                className={`rounded-lg border px-3 py-2 text-left text-sm ${v.empaque === k ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white"}`}
              >
                <span className="block font-semibold">{k === "bulto" ? "Bultos" : "Tarima"}</span>
                <span className="block text-xs text-slate-500">{k === "bulto" ? "Cajas o paquetes sueltos" : "Mercancía emplayada sobre tarima"}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Field label={v.empaque === "tarima" ? "Tarimas *" : "Bultos *"}><Input value={s("bultos")} onChange={set("bultos")} inputMode="numeric" /></Field>
          <Field label="Peso total kg *"><Input value={s("peso_kg")} onChange={set("peso_kg")} inputMode="decimal" /></Field>
          <Field label={v.empaque === "tarima" ? "Largo cm (tarima)" : "Largo cm"}><Input value={s("largo_cm")} onChange={set("largo_cm")} inputMode="decimal" /></Field>
          <Field label="Ancho cm"><Input value={s("ancho_cm")} onChange={set("ancho_cm")} inputMode="decimal" /></Field>
          <Field label="Alto cm"><Input value={s("alto_cm")} onChange={set("alto_cm")} inputMode="decimal" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contenido"><Input value={s("contenido")} onChange={set("contenido")} placeholder="Ej. 10 cajas de guantes de nitrilo" /></Field>
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
