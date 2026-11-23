"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, Input, StatCard } from "@/components/ui";
import type { ComVendedor } from "@/lib/comisiones";
import { fmtMonedas2 as fmtMonedas, money, money2, porMoneda } from "@/lib/ventas";

const fecha = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "");

/** Comisiones por vendedor (se abre cada uno) y por factura con el detalle de cada articulo. */
export function ComisionesTabla({ vendedores }: { vendedores: ComVendedor[] }) {
  const [buscar, setBuscar] = useState("");
  const t = buscar.trim().toLowerCase();
  const lista = useMemo(
    () =>
      vendedores
        .map((v) => ({ ...v, facturas: t ? v.facturas.filter((f) => [f.factura ?? "", f.cliente].some((x) => x.toLowerCase().includes(t))) : v.facturas }))
        .filter((v) => v.facturas.length > 0),
    [vendedores, t],
  );
  const todas = lista.flatMap((v) => v.facturas);
  const total = porMoneda(todas, (f) => f.comision);
  const faltan = todas.filter((f) => f.faltan > 0).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Comisión total" value={fmtMonedas(total)} tone="green" />
        <StatCard label="Facturas" value={todas.length} />
        <StatCard label="Vendedores" value={lista.length} />
        <StatCard label="Sin comisión completa" value={faltan} tone={faltan ? "amber" : "default"} hint="Falta % o importe" />
      </div>
      <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar factura o cliente" />
      {lista.length === 0 && <Card className="text-sm text-slate-600">No hay ventas en esta vista.</Card>}
      {lista.map((v) => {
        const tv = porMoneda(v.facturas, (f) => f.comision);
        const fv = v.facturas.filter((f) => f.faltan > 0).length;
        return (
          <details key={v.id} className="group rounded-xl border border-slate-200 bg-white shadow-sm" open={!!t || lista.length === 1}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="font-semibold text-slate-900">{v.nombre}</span>
                <span className="block text-xs text-slate-500">{v.facturas.length} factura(s){fv ? ` · ${fv} sin comisión completa` : ""}</span>
              </span>
              <span className="text-right">
                <span className="block text-lg font-bold tabular-nums text-slate-900">{fmtMonedas(tv)}</span>
                <span className="text-xs text-brand-700 group-open:hidden">Ver facturas</span>
              </span>
            </summary>
            <div className="space-y-3 border-t border-slate-100 p-3">
              {v.facturas.map((f) => (
                <div key={f.id} className={`rounded-lg border ${f.faltan ? "border-amber-300" : "border-slate-200"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                    <span>
                      <Link href={`/vendedor/bitacora/venta/${f.id}?comision=1#comision`} className="font-semibold text-slate-900 hover:underline">{f.factura ? `Factura ${f.factura}` : "Venta sin folio"}</Link>
                      <span className="text-slate-600"> · {f.cliente}</span>
                      <span className="block text-xs text-slate-500">
                        {fecha(f.fecha)}{f.monto != null ? ` · total ${money(f.monto, f.moneda)}` : ""}{f.pagada ? ` · pagada ${fecha(f.fecha_cobro)}` : " · por cobrar"}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-bold tabular-nums text-slate-900">{money2(f.comision, f.moneda)}</span>
                      {f.faltan > 0 && <span className="text-xs font-semibold text-amber-800">Falta en {f.faltan} artículo(s)</span>}
                    </span>
                  </div>
                  <table className="w-full table-fixed text-sm">
                    <colgroup><col /><col className="w-32" /><col className="w-16" /><col className="w-32" /></colgroup>
                    <thead className="text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">Artículo</th>
                        <th className="px-3 py-1.5 text-right font-medium">Importe</th>
                        <th className="px-3 py-1.5 text-right font-medium">%</th>
                        <th className="px-3 py-1.5 text-right font-medium">Comisión</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {f.lineas.map((l) => (
                        <tr key={l.id}>
                          <td className="px-3 py-1.5">
                            {l.clave && <span className="font-mono text-xs text-slate-500">{l.clave} · </span>}
                            {l.descripcion}
                            {l.cantidad != null && <span className="text-xs text-slate-500"> · {l.cantidad} pza(s)</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{l.importe == null ? <span className="text-amber-700">falta</span> : money2(l.importe, f.moneda)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{l.pct == null ? <span className="text-amber-700">falta</span> : `${l.pct}%`}</td>
                          <td className="px-3 py-1.5 text-right font-medium tabular-nums">{l.comision == null ? "-" : money2(l.comision, f.moneda)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
