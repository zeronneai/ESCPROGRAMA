"use client";

import { useState } from "react";
import { saveConsumoAction } from "@/actions/consumo";
import { areaCls, useRun } from "@/components/ops-ui";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { CATEGORIAS, type ConsumoInput } from "@/lib/ops/consumo";

export function ConsumoForm({ id, initial, onDone }: { id: string | null; initial?: Partial<Record<keyof ConsumoInput, string | boolean>>; onDone?: () => void }) {
  const [v, setV] = useState<Record<keyof ConsumoInput, string | boolean>>({
    tipo: "producto", categoria: "", descripcion: "", cantidad: "1", unidad: "", motivo: "", urgente: false, ...initial,
  });
  const { run, busy, notice, router } = useRun();
  const set = (k: keyof ConsumoInput) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const servicio = v.tipo === "servicio";
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run("save", () => saveConsumoAction(id, v as unknown as ConsumoInput), (r) => {
          if (onDone) {
            onDone();
            router.refresh();
          } else if (r.ok) router.push(`/consumo/${r.id}`);
        });
      }}
    >
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="flex rounded-md border border-slate-300 bg-white p-0.5 text-sm sm:inline-flex">
        {(["producto", "servicio"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setV((s) => ({ ...s, tipo: t, categoria: t === "servicio" && !s.categoria ? "vehiculo" : s.categoria }))} className={`flex-1 rounded px-4 py-1.5 ${v.tipo === t ? "bg-slate-800 text-white" : "text-slate-600"}`}>
            {t === "producto" ? "Producto o material" : "Servicio"}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Categoría *">
          <Select value={v.categoria as string} onChange={set("categoria")}>
            <option value="">Elige</option>
            {Object.entries(CATEGORIAS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label={servicio ? "¿Qué servicio? *" : "¿Qué necesitas? *"}>
          <Input value={v.descripcion as string} onChange={set("descripcion")} placeholder={servicio ? "Ej. Afinación y cambio de aceite, Nissan NP300 placas ABC-123" : "Ej. Hojas tamaño carta"} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cantidad *"><Input value={v.cantidad as string} onChange={set("cantidad")} inputMode="decimal" /></Field>
          <Field label="Unidad"><Input value={v.unidad as string} onChange={set("unidad")} placeholder={servicio ? "servicio" : "paquete, caja, pieza"} /></Field>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-red-700">
          <input type="checkbox" checked={!!v.urgente} onChange={(e) => setV((s) => ({ ...s, urgente: e.target.checked }))} /> Es urgente
        </label>
      </div>
      <Field label="¿Para qué se necesita? *">
        <textarea value={v.motivo as string} onChange={set("motivo")} rows={2} className={areaCls} placeholder={servicio ? "Ej. Ya le toca servicio por kilometraje" : "Ej. Se acabaron, se usan para imprimir cotizaciones"} />
      </Field>
      <p className="text-xs text-slate-500">La jefa de ventas la aprueba y después el comprador la pide o la agenda. Verás cada paso aquí.</p>
      <div className="flex gap-2">
        <Button type="submit" loading={busy === "save"}>{id ? "Guardar cambios" : "Enviar solicitud"}</Button>
        {onDone && <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>}
      </div>
    </form>
  );
}
