"use client";

import { useState } from "react";
import { saveQuejaAction } from "@/actions/calidad";
import { areaCls, CustomerLookup, useRun } from "@/components/ops-ui";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { VIAS, VIAS_CAPTURA, type QuejaInput } from "@/lib/ops/calidad";

type F = Record<keyof QuejaInput, string | null>;

export function QuejaForm({
  id, initial, today, sellers, onDone,
}: { id: string | null; initial?: Partial<F>; today: string; sellers?: { id: string; nombre: string }[]; onDone?: () => void }) {
  const [v, setV] = useState<F>({
    fecha_recepcion: today, via_recepcion: "", responsable_nombre: "", customer_id: null, cliente_nombre: "", contacto_nombre: "",
    contacto_medio: "", referencia: "", descripcion: "", vendedor_id: null, ...initial,
  });
  const { run, busy, notice, router } = useRun();
  const set = (k: keyof F) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const s = (k: keyof F) => v[k] ?? "";
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        run("save", () => saveQuejaAction(id, { ...v, vendedor_id: v.vendedor_id || null } as unknown as QuejaInput), (r) => {
          if (onDone) {
            onDone();
            router.refresh();
          } else if (r.ok) router.push(`/calidad/quejas/${r.id}`);
        });
      }}
    >
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Fecha de recepción *"><Input type="date" value={s("fecha_recepcion")} onChange={set("fecha_recepcion")} /></Field>
        <Field label="Vía de recepción *">
          <Select value={s("via_recepcion")} onChange={set("via_recepcion")}>
            <option value="">Elige</option>
            {Object.entries(v.via_recepcion === "link" ? VIAS : VIAS_CAPTURA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Responsable de la recepción"><Input value={s("responsable_nombre")} onChange={set("responsable_nombre")} placeholder="Si lo dejas vacío, quedas tú" /></Field>
        {sellers && (
          <Field label="Vendedor del cliente">
            <Select value={s("vendedor_id")} onChange={set("vendedor_id")}>
              <option value="">Sin vendedor</option>
              {sellers.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Datos del cliente</h3>
        <CustomerLookup
          onPick={(c) => setV((x) => ({
            ...x, customer_id: c.id, cliente_nombre: c.nombre, contacto_nombre: c.contacto_nombre ?? x.contacto_nombre,
            contacto_medio: [c.contacto_telefono, c.contacto_correo].filter(Boolean).join(" / ") || x.contacto_medio,
          }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre de la empresa / cliente *"><Input value={s("cliente_nombre")} onChange={(e) => setV((x) => ({ ...x, cliente_nombre: e.target.value, customer_id: null }))} /></Field>
          <Field label="Persona de contacto"><Input value={s("contacto_nombre")} onChange={set("contacto_nombre")} /></Field>
          <Field label="Teléfono / correo"><Input value={s("contacto_medio")} onChange={set("contacto_medio")} /></Field>
          <Field label="Pedido / factura / orden de compra"><Input value={s("referencia")} onChange={set("referencia")} /></Field>
        </div>
      </div>
      <Field label="Descripción del problema / queja *">
        <textarea value={s("descripcion")} onChange={set("descripcion")} rows={5} className={areaCls} placeholder="Qué pasó, con qué producto, cantidades, desde cuándo, qué pide el cliente" />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" loading={busy === "save"}>{id ? "Guardar cambios" : "Registrar queja"}</Button>
        {onDone && <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>}
      </div>
    </form>
  );
}
