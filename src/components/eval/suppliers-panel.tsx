"use client";

import { useState } from "react";
import { saveSupplierAction, setSupplierFlagsAction } from "@/actions/evaluaciones";
import { SupplierImport } from "@/components/eval/supplier-tools";
import { Icon } from "@/components/icons";
import { Chip, useRun } from "@/components/ops-ui";
import { Alert, Button, Card, EmptyState, Field, Input, Select } from "@/components/ui";
import { clasificacionProveedor, type SupplierInput, type SupplierRow } from "@/lib/evaluaciones";

type F = Record<keyof SupplierInput, string | boolean>;
const toF = (s: SupplierRow | null): F => ({
  nombre: s?.nombre ?? "", razon_social: s?.razon_social ?? "", rfc: s?.rfc ?? "", tipo: s?.tipo ?? "nacional", pais: s?.pais ?? "",
  giro: s?.giro ?? "", contacto_nombre: s?.contacto_nombre ?? "", telefono: s?.telefono ?? "", correo: s?.correo ?? "",
  direccion: s?.direccion ?? "", sitio_web: s?.sitio_web ?? "", condiciones_pago: s?.condiciones_pago ?? "", notas: s?.notas ?? "", evaluar: s?.evaluar ?? true,
});

export function SupplierForm({ s, onSaved, onCancel }: { s: SupplierRow | null; onSaved: (x: SupplierRow) => void; onCancel: () => void }) {
  const [v, setV] = useState<F>(toF(s));
  const { run, busy, notice } = useRun();
  const set = (k: keyof F) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const t = (k: keyof F) => v[k] as string;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run("save", () => saveSupplierAction(s?.id ?? null, v as unknown as SupplierInput), (r) => {
          if (r.ok) onSaved((r as unknown as { supplier: SupplierRow }).supplier);
        });
      }}
    >
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre (como lo conocen) *"><Input value={t("nombre")} onChange={set("nombre")} /></Field>
        <Field label="Razón social"><Input value={t("razon_social")} onChange={set("razon_social")} /></Field>
        <Field label="RFC / Tax ID"><Input value={t("rfc")} onChange={set("rfc")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Origen">
            <Select value={t("tipo")} onChange={set("tipo")}><option value="nacional">Nacional</option><option value="extranjero">Extranjero</option></Select>
          </Field>
          <Field label="País"><Input value={t("pais")} onChange={set("pais")} placeholder={v.tipo === "extranjero" ? "China, USA..." : "México"} /></Field>
        </div>
        <Field label="¿Qué nos surte?"><Input value={t("giro")} onChange={set("giro")} placeholder="Guantes, batas, químicos..." /></Field>
        <Field label="Persona de contacto"><Input value={t("contacto_nombre")} onChange={set("contacto_nombre")} /></Field>
        <Field label="Teléfono / WhatsApp"><Input value={t("telefono")} onChange={set("telefono")} /></Field>
        <Field label="Correo"><Input value={t("correo")} onChange={set("correo")} type="email" /></Field>
        <Field label="Dirección"><Input value={t("direccion")} onChange={set("direccion")} /></Field>
        <Field label="Sitio web"><Input value={t("sitio_web")} onChange={set("sitio_web")} /></Field>
        <Field label="Condiciones de pago"><Input value={t("condiciones_pago")} onChange={set("condiciones_pago")} placeholder="Contado, 30 días, anticipo 50%..." /></Field>
        <Field label="Notas"><Input value={t("notas")} onChange={set("notas")} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!v.evaluar} onChange={(e) => setV((x) => ({ ...x, evaluar: e.target.checked }))} /> Incluir en la evaluación de proveedores
      </label>
      <div className="flex gap-2">
        <Button type="submit" loading={busy === "save"}>{s ? "Guardar" : "Dar de alta"}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}

export function SuppliersPanel({ suppliers: initial, scores, cotizaciones }: { suppliers: SupplierRow[]; scores: Record<string, { puntaje: number | null; periodo: string }>; cotizaciones: Record<string, number> }) {
  const [list, setList] = useState(initial);
  const [q, setQ] = useState("");
  const [ver, setVer] = useState<"todos" | "evaluados" | "inactivos">("todos");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { run, busy, notice } = useRun();
  const upsert = (s: SupplierRow) => {
    setList((l) => (l.some((x) => x.id === s.id) ? l.map((x) => (x.id === s.id ? s : x)) : [s, ...l]));
    setEditing(null);
  };
  const shown = list
    .filter((s) => (ver === "inactivos" ? !s.activo : s.activo && (ver === "todos" || s.evaluar)))
    .filter((s) => !q || [s.nombre, s.razon_social, s.rfc, s.giro, s.contacto_nombre, s.correo].some((x) => x?.toLowerCase().includes(q.toLowerCase())));
  const incompletos = (s: SupplierRow) => [!s.contacto_nombre && "contacto", !s.telefono && !s.correo && "teléfono o correo", !s.giro && "qué surte"].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Proveedores</h1>
          <p className="text-sm text-slate-500">Alta y datos de proveedores. Los que tienen "Evaluar" entran a la evaluación semestral.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SupplierImport onDone={() => window.location.reload()} />
          <Button onClick={() => setEditing("new")}><Icon name="plus" className="h-4 w-4" /> Nuevo proveedor</Button>
        </div>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {editing === "new" && <Card className="p-4 sm:p-5"><SupplierForm s={null} onSaved={upsert} onCancel={() => setEditing(null)} /></Card>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, RFC, contacto o qué surte" />
        <div className="flex gap-1.5 text-xs">
          {([["todos", "Activos"], ["evaluados", "Se evalúan"], ["inactivos", "Inactivos"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setVer(k)} className={`shrink-0 rounded-full border px-3 py-1.5 font-medium ${ver === k ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{l}</button>
          ))}
        </div>
      </div>
      <Card className="p-0">
        {shown.length === 0 ? (
          <EmptyState title="Sin proveedores en esta vista" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((s) => {
              const sc = scores[s.id];
              const cl = clasificacionProveedor(sc?.puntaje ?? null);
              const miss = incompletos(s);
              return (
                <li key={s.id} className="px-4 py-3">
                  {editing === s.id ? (
                    <SupplierForm s={s} onSaved={upsert} onCancel={() => setEditing(null)} />
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 text-sm">
                        <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                          {s.nombre}
                          {s.tipo === "extranjero" && <Chip cls="bg-sky-100 text-sky-800">{s.pais || "Extranjero"}</Chip>}
                          {s.evaluar && <Chip cls="bg-slate-100 text-slate-700">Se evalúa</Chip>}
                          {cl && <Chip cls={cl.cls}>{cl.label} {sc?.puntaje}%</Chip>}
                        </p>
                        <p className="text-xs text-slate-500">{[s.giro, s.contacto_nombre, s.telefono, s.correo].filter(Boolean).join(" · ") || "Sin datos de contacto"}</p>
                        <p className="text-xs text-slate-400">{cotizaciones[s.nombre.trim().toLowerCase()] ?? 0} cotización(es){sc && ` · Última evaluación ${sc.periodo}`}</p>
                        {miss.length > 0 && <p className="text-xs text-amber-800">Falta: {miss.join(", ")}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <Button variant="secondary" className="text-xs" onClick={() => setEditing(s.id)}>{miss.length ? "Completar" : "Editar"}</Button>
                        <Button variant="ghost" className="text-xs" disabled={!!busy} onClick={() => run(`e${s.id}`, async () => {
                          const r = await setSupplierFlagsAction(s.id, { evaluar: !s.evaluar });
                          if (r.ok) setList((l) => l.map((x) => (x.id === s.id ? { ...x, evaluar: !s.evaluar } : x)));
                          return r;
                        })}>{s.evaluar ? "No evaluar" : "Evaluar"}</Button>
                        <Button variant="ghost" className="text-xs" disabled={!!busy} onClick={() => run(`a${s.id}`, async () => {
                          const r = await setSupplierFlagsAction(s.id, { activo: !s.activo });
                          if (r.ok) setList((l) => l.map((x) => (x.id === s.id ? { ...x, activo: !s.activo } : x)));
                          return r;
                        })}>{s.activo ? "Desactivar" : "Reactivar"}</Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
