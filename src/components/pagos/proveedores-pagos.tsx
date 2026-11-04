"use client";

import { useState } from "react";
import { proveedorPagosAction } from "@/actions/pagos";
import { useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Select } from "@/components/ui";
import { MONEDAS } from "@/lib/pagos";

export type ProvPagos = { id: string; nombre: string; pais: string | null; tipo: string; en_pagos: boolean; pagos_moneda: string; ocs: number };

/** Comprador: que proveedores entran a la seccion de pagos. */
export function ProveedoresPagos({ proveedores }: { proveedores: ProvPagos[] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState("");
  const [moneda, setMoneda] = useState("USD");
  const { run, busy, notice } = useRun();
  const dentro = proveedores.filter((p) => p.en_pagos);
  const fuera = proveedores.filter((p) => !p.en_pagos).sort((a, b) => Number(b.tipo === "extranjero") - Number(a.tipo === "extranjero") || a.nombre.localeCompare(b.nombre));
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">Proveedores en pagos ({dentro.length})</p>
          <p className="text-xs text-slate-500">Elige de tu lista de proveedores cuáles se pagan por aquí.</p>
        </div>
        <Button variant="secondary" className="text-xs" onClick={() => setOpen((o) => !o)}>{open ? "Cerrar" : "Agregar o quitar"}</Button>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {open && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={sel} onChange={(e) => { setSel(e.target.value); const p = fuera.find((x) => x.id === e.target.value); if (p) setMoneda(p.tipo === "extranjero" ? "USD" : "MXN"); }}>
              <option value="">Elige un proveedor...</option>
              {fuera.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.pais ? ` (${p.pais})` : ""}</option>)}
            </Select>
            <Select value={moneda} onChange={(e) => setMoneda(e.target.value)} className="sm:w-28!">{MONEDAS.map((m) => <option key={m}>{m}</option>)}</Select>
            <Button disabled={!sel} loading={busy === "add"} onClick={() => run("add", () => proveedorPagosAction(sel, true, moneda), "Proveedor agregado a pagos.")}>Agregar</Button>
          </div>
          {fuera.length === 0 && <p className="text-xs text-slate-500">Todos tus proveedores ya están aquí. Para uno nuevo, dalo de alta con el botón &quot;Proveedor&quot; de arriba.</p>}
          {dentro.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
              {dentro.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span>{p.nombre} <span className="text-xs text-slate-500">{p.pagos_moneda} · {p.ocs} OC</span></span>
                  {p.ocs === 0 && (
                    <button type="button" disabled={!!busy} onClick={() => run(`x${p.id}`, () => proveedorPagosAction(p.id, false), "Proveedor quitado de pagos.")} className="text-xs text-red-700 underline">Quitar</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
