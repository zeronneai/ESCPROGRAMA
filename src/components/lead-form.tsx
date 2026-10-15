"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createLeadAction, updateLeadAction } from "@/actions/leads";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import {
  LEAD_SOURCES,
  LEAD_STAGES,
  LOST_REASONS,
  PRIORITIES,
  PRIORITY_LABEL,
  SOURCE_LABEL,
  STAGE_HINT,
  STAGE_LABEL,
  type LeadRow,
} from "@/lib/leads/types";
import type { LeadInput } from "@/lib/validation/lead";

const INDUSTRIAS = ["Electrónica", "Automotriz", "Dispositivos médicos", "Aeroespacial", "Laboratorio", "Alimentos", "Construcción", "Otra"];

function toInput(l?: LeadRow | null): Required<{ [K in keyof LeadInput]: string }> {
  return {
    empresa: l?.empresa ?? "",
    contacto_nombre: l?.contacto_nombre ?? "",
    contacto_puesto: l?.contacto_puesto ?? "",
    telefono: l?.telefono ?? "",
    correo: l?.correo ?? "",
    ciudad: l?.ciudad ?? "",
    industria: l?.industria ?? "",
    producto_interes: l?.producto_interes ?? "",
    origen: l?.origen ?? "llamada_fria",
    origen_detalle: l?.origen_detalle ?? "",
    etapa: l?.etapa ?? "nuevo",
    prioridad: l?.prioridad ?? "media",
    valor_estimado: l?.valor_estimado === null || l?.valor_estimado === undefined ? "" : String(Number(l.valor_estimado)),
    moneda: l?.moneda ?? "MXN",
    proximo_seguimiento: l?.proximo_seguimiento ?? "",
    motivo_perdida: l?.motivo_perdida ?? "",
    notas: l?.notas ?? "",
  };
}

const textarea =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600";

/** Alta y edicion de un lead. */
export function LeadForm({ lead, onDone }: { lead?: LeadRow | null; onDone?: () => void }) {
  const router = useRouter();
  const [v, setV] = useState(() => toInput(lead));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: "" }));
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    start(async () => {
      const r = lead ? await updateLeadAction(lead.id, v as LeadInput) : await createLeadAction(v as LeadInput);
      if (!r.ok) {
        setErrors(("fields" in r && r.fields) || {});
        setNotice(r.error);
        return;
      }
      if (lead) {
        onDone?.();
        router.refresh();
      } else if ("id" in r) {
        router.push(`/vendedor/leads/${r.id}`);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {notice && <Alert tone="error">{notice}</Alert>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Prospecto</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Empresa o prospecto *" error={errors.empresa}>
            <Input value={v.empresa} onChange={set("empresa")} placeholder="Ej. Planta Electrónica del Norte" autoFocus={!lead} />
          </Field>
          <Field label="Industria" error={errors.industria}>
            <Input value={v.industria} onChange={set("industria")} list="industrias" placeholder="Ej. Automotriz" />
            <datalist id="industrias">{INDUSTRIAS.map((i) => <option key={i} value={i} />)}</datalist>
          </Field>
          <Field label="Nombre del contacto" error={errors.contacto_nombre}>
            <Input value={v.contacto_nombre} onChange={set("contacto_nombre")} autoComplete="off" />
          </Field>
          <Field label="Puesto" error={errors.contacto_puesto}>
            <Input value={v.contacto_puesto} onChange={set("contacto_puesto")} placeholder="Ej. Comprador MRO" />
          </Field>
          <Field label="Teléfono / WhatsApp" error={errors.telefono}>
            <Input value={v.telefono} onChange={set("telefono")} type="tel" inputMode="tel" placeholder="614 123 4567" />
          </Field>
          <Field label="Correo" error={errors.correo}>
            <Input value={v.correo} onChange={set("correo")} type="email" inputMode="email" autoComplete="off" />
          </Field>
          <Field label="Ciudad / planta" error={errors.ciudad}>
            <Input value={v.ciudad} onChange={set("ciudad")} placeholder="Ej. Cd. Juárez" />
          </Field>
          <Field label="¿Cómo llegó?" error={errors.origen}>
            <Select value={v.origen} onChange={set("origen")}>
              {LEAD_SOURCES.map((o) => (
                <option key={o} value={o}>
                  {SOURCE_LABEL[o]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {(v.origen === "referido" || v.origen === "expo_evento" || v.origen === "otro" || v.origen_detalle) && (
          <Field label={v.origen === "referido" ? "¿Quién lo refirió?" : "Detalle del origen"} error={errors.origen_detalle}>
            <Input value={v.origen_detalle} onChange={set("origen_detalle")} />
          </Field>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Interés y seguimiento</h2>
        <Field label="Producto que le interesa o le puede interesar" error={errors.producto_interes}>
          <textarea
            value={v.producto_interes}
            onChange={set("producto_interes")}
            rows={2}
            className={textarea}
            placeholder="Ej. Guantes de nitrilo talla M, wipes para cuarto limpio ISO 7"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Etapa" error={errors.etapa}>
            <Select value={v.etapa} onChange={set("etapa")}>
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridad" error={errors.prioridad}>
            <Select value={v.prioridad} onChange={set("prioridad")}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Próximo seguimiento" error={errors.proximo_seguimiento}>
            <Input type="date" value={v.proximo_seguimiento} onChange={set("proximo_seguimiento")} />
          </Field>
          <Field label="Valor estimado (opcional)" error={errors.valor_estimado}>
            <div className="flex gap-2">
              <Input value={v.valor_estimado} onChange={set("valor_estimado")} inputMode="decimal" placeholder="0" />
              <Select value={v.moneda} onChange={set("moneda")} className="w-24 shrink-0">
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </Select>
            </div>
          </Field>
        </div>
        <p className="text-xs text-slate-500">{STAGE_HINT[v.etapa as keyof typeof STAGE_HINT]}</p>
        {v.etapa === "perdido" && (
          <Field label="¿Por qué se perdió? *" error={errors.motivo_perdida}>
            <Input value={v.motivo_perdida} onChange={set("motivo_perdida")} list="motivos-perdida" />
            <datalist id="motivos-perdida">{LOST_REASONS.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
        )}
        <Field label="Notas" error={errors.notas}>
          <textarea value={v.notas} onChange={set("notas")} rows={3} className={textarea} placeholder="Lo que sepas de su consumo, proveedor actual, volúmenes..." />
        </Field>
      </section>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] -mx-4 flex gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <Button type="submit" loading={pending} className="flex-1 md:flex-none">
          {lead ? "Guardar cambios" : "Guardar lead"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => (onDone ? onDone() : router.back())} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
