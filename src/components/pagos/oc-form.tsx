"use client";

import { useState } from "react";
import { saveOcAction } from "@/actions/pagos";
import { areaCls, useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { MONEDAS, type Moneda, type OcRow, type PagoInput } from "@/lib/pagos";

export type ProvOpcion = { id: string; nombre: string; pagos_moneda: string };
type Linea = { tipo: "anticipo" | "factura"; numero_factura: string; fecha_factura: string; monto: string; fecha_limite: string; notas: string };
const LV: Linea = { tipo: "factura", numero_factura: "", fecha_factura: "", monto: "", fecha_limite: "", notas: "" };

/** Alta o edicion de la orden de compra. En el alta se pueden capturar ya sus facturas o anticipos. */
export function OcForm({ oc, proveedores, today, proveedorInicial, onDone }: { oc: OcRow | null; proveedores: ProvOpcion[]; today: string; proveedorInicial?: string; onDone?: () => void }) {
  const [v, setV] = useState({
    supplier_id: oc?.supplier_id ?? proveedorInicial ?? "",
    numero: oc?.numero ?? "",
    fecha: oc?.fecha ?? today,
    moneda: (oc?.moneda ?? (proveedores.find((p) => p.id === proveedorInicial)?.pagos_moneda as Moneda) ?? "USD") as Moneda,
    monto: oc?.monto != null ? String(Number(oc.monto)) : "",
    descripcion: oc?.descripcion ?? "",
  });
  const [lineas, setLineas] = useState<Linea[]>([]);
  const { run, busy, notice, router } = useRun();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const setL = (i: number, k: keyof Linea, val: string) => setLineas((l) => l.map((x, j) => (j === i ? { ...x, [k]: val } : x)));

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Proveedor *">
          <Select value={v.supplier_id} disabled={!!oc} onChange={(e) => { const p = proveedores.find((x) => x.id === e.target.value); setV((s) => ({ ...s, supplier_id: e.target.value, moneda: (p?.pagos_moneda as Moneda) ?? s.moneda })); }}>
            <option value="">Elige...</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Número de OC *"><Input value={v.numero} onChange={set("numero")} placeholder="Ej. OC-2026-118" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Fecha de la OC *"><Input type="date" value={v.fecha} onChange={set("fecha")} /></Field>
        <Field label="Moneda *"><Select value={v.moneda} onChange={set("moneda")}>{MONEDAS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label="Monto total de la OC"><Input value={v.monto} onChange={set("monto")} inputMode="decimal" placeholder="Opcional" /></Field>
      </div>
      <Field label="Descripción">
        <textarea value={v.descripcion} onChange={set("descripcion")} rows={2} className={areaCls} placeholder="Qué se compró (ej. 2 contenedores de guante de nitrilo)" />
      </Field>

      {!oc && (
        <div className="space-y-2">
          <div>
            <p className="text-sm font-semibold text-slate-800">Facturas o anticipos (opcional)</p>
            <p className="text-xs text-slate-500">Si ya tienes la factura o el anticipo, agrégalo. Si no, lo capturas después cuando llegue.</p>
          </div>
          {lineas.map((l, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[8rem_1fr_9rem_9rem_9rem_auto]">
              <Select value={l.tipo} onChange={(e) => setL(i, "tipo", e.target.value)}><option value="factura">Factura</option><option value="anticipo">Anticipo</option></Select>
              <Input value={l.numero_factura} onChange={(e) => setL(i, "numero_factura", e.target.value)} placeholder={l.tipo === "anticipo" ? "Proforma (opcional)" : "Núm. de factura"} />
              <Input value={l.monto} onChange={(e) => setL(i, "monto", e.target.value)} inputMode="decimal" placeholder={`Monto ${v.moneda}`} />
              <Input type="date" value={l.fecha_factura} onChange={(e) => setL(i, "fecha_factura", e.target.value)} title="Fecha de la factura" />
              <Input type="date" value={l.fecha_limite} onChange={(e) => setL(i, "fecha_limite", e.target.value)} title="Fecha límite de pago" />
              <button type="button" onClick={() => setLineas((x) => x.filter((_, j) => j !== i))} className="px-2 text-sm text-red-700">Quitar</button>
            </div>
          ))}
          {lineas.length > 0 && <p className="text-[11px] text-slate-500">Fechas: la primera es la de la factura y la segunda la fecha límite de pago.</p>}
          <Button type="button" variant="secondary" className="text-xs" onClick={() => setLineas((l) => [...l, { ...LV, tipo: l.length === 0 ? "anticipo" : "factura" }])}>+ Agregar factura o anticipo</Button>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          loading={busy === "s"}
          disabled={!v.supplier_id || !v.numero.trim()}
          onClick={() =>
            run("s", () => saveOcAction(oc?.id ?? null, v, lineas as unknown as PagoInput[]), (r) => {
              if (!r.ok) return;
              if (onDone) onDone();
              else router.push(`/pagos/oc/${r.id}`);
              router.refresh();
            })
          }
        >
          {oc ? "Guardar OC" : "Registrar OC"}
        </Button>
        {onDone && <Button variant="ghost" onClick={onDone}>Cancelar</Button>}
      </div>
    </Card>
  );
}
