"use client";

import { Fragment, useMemo, useState } from "react";
import { Card, Input } from "@/components/ui";

export interface VentaInv {
  fecha: string;
  factura: string | null;
  cliente: string;
  vendedor: string;
  cantidad: number;
  venta_id: string;
}
export interface ArtInv {
  clave: string;
  nombre: string;
  proveedor: string;
  um: string | null;
  corte: number;
  vendido: number;
  recibido: number;
  existencia: number;
  ventas: VentaInv[];
}
export interface SinDescontar {
  fecha: string;
  factura: string | null;
  cliente: string;
  vendedor: string;
  descripcion: string;
  clave: string | null;
  cantidad: number;
  motivo: string;
  venta_id: string;
}

type Ver = "todos" | "vendidos" | "sin" | "negativos";
const n = (x: number) => x.toLocaleString("es-MX", { maximumFractionDigits: 2 });
const f = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

/** Inventario por articulo (kardex al corte - ventas del portal + recibido) y las ventas que lo descontaron. */
export function InventarioLista({ articulos, sinDescontar }: { articulos: ArtInv[]; sinDescontar: SinDescontar[] }) {
  const [buscar, setBuscar] = useState("");
  const [ver, setVer] = useState<Ver>("todos");
  const [abierto, setAbierto] = useState<string | null>(null);
  const t = buscar.trim().toLowerCase();
  const lista = useMemo(
    () =>
      articulos.filter((a) => {
        if (ver === "vendidos" && !a.ventas.length) return false;
        if (ver === "sin" && a.existencia > 0) return false;
        if (ver === "negativos" && a.existencia >= 0) return false;
        return !t || a.clave.toLowerCase().includes(t) || a.nombre.toLowerCase().includes(t) || a.proveedor.toLowerCase().includes(t);
      }),
    [articulos, ver, t],
  );
  const sd = t ? sinDescontar.filter((s) => [s.descripcion, s.factura ?? "", s.cliente, s.clave ?? ""].some((x) => x.toLowerCase().includes(t))) : sinDescontar;
  const cuenta = (v: Ver) => articulos.filter((a) => (v === "vendidos" ? a.ventas.length > 0 : v === "sin" ? a.existencia <= 0 : v === "negativos" ? a.existencia < 0 : true)).length;
  const nombre: Record<Ver, string> = { todos: "Todos", vendidos: "Con ventas desde el corte", sin: "Sin existencia", negativos: "Existencia negativa" };

  return (
    <div className="space-y-4">
      <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por clave, nombre o proveedor (ej. ESC-GN100, guante, topglove)" className="text-base" autoFocus />
      <div className="flex flex-wrap gap-2">
        {(Object.keys(nombre) as Ver[]).map((v) => (
          <button key={v} type="button" onClick={() => setVer(v)} className={`rounded-full border px-3 py-1 text-sm ${ver === v ? "border-slate-800 bg-slate-800 text-white" : v === "negativos" && cuenta(v) ? "border-red-300 bg-red-50 text-red-800" : "border-slate-300 bg-white text-slate-700"}`}>
            {nombre[v]} {cuenta(v)}
          </button>
        ))}
      </div>

      {sd.length > 0 && (
        <details className="rounded-xl border border-amber-300 bg-amber-50" open={!!t}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-amber-900">
            ⚠ {sd.length} renglón(es) de venta desde el corte que NO se descontaron del inventario
          </summary>
          <div className="space-y-1 border-t border-amber-200 px-4 py-3">
            <p className="text-xs text-amber-900">Son artículos de facturas que el sistema no pudo ligar a una clave del kárdex (la clave de la factura no existe en el catálogo o en la planeación). Revisa si la clave está bien escrita en la factura o en el catálogo.</p>
            <div className="max-h-80 overflow-auto rounded-lg border border-amber-200 bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-amber-100 text-xs text-amber-900">
                  <tr><th className="px-3 py-1.5 text-left">Fecha</th><th className="px-3 py-1.5 text-left">Factura</th><th className="px-3 py-1.5 text-left">Artículo</th><th className="px-3 py-1.5 text-right">Cant.</th><th className="px-3 py-1.5 text-left">Por qué</th></tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {sd.slice(0, 300).map((s, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{f(s.fecha)}</td>
                      <td className="px-3 py-1.5"><span className="font-medium">{s.factura ?? "-"}</span><span className="block text-xs text-slate-500">{s.cliente} · {s.vendedor}</span></td>
                      <td className="px-3 py-1.5">{s.clave && <span className="font-mono text-xs text-slate-500">{s.clave} · </span>}{s.descripcion}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{n(s.cantidad)}</td>
                      <td className="px-3 py-1.5 text-xs text-amber-900">{s.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Artículo</th>
              <th className="px-3 py-2 text-right font-medium">Kárdex al corte</th>
              <th className="px-3 py-2 text-right font-medium">− Vendido (portal)</th>
              <th className="px-3 py-2 text-right font-medium">+ Recibido</th>
              <th className="px-3 py-2 text-right font-medium">= Existencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lista.slice(0, 600).map((a) => (
              <Fragment key={a.clave}>
                <tr onClick={() => setAbierto(abierto === a.clave ? null : a.clave)} className={`cursor-pointer hover:bg-slate-50 ${abierto === a.clave ? "bg-brand-50/40" : ""}`}>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs font-semibold text-slate-700">{a.clave}</span>
                    <span className="block text-slate-800">{a.nombre}</span>
                    <span className="text-xs text-slate-500">{a.proveedor}{a.ventas.length ? ` · ${a.ventas.length} venta(s) desde el corte ▾` : ""}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{n(a.corte)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-700">{a.vendido ? `−${n(a.vendido)}` : "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-green-700">{a.recibido ? `+${n(a.recibido)}` : "-"}</td>
                  <td className={`px-3 py-2 text-right text-base font-bold tabular-nums ${a.existencia < 0 ? "text-red-700" : a.existencia === 0 ? "text-amber-700" : "text-slate-900"}`}>{n(a.existencia)} <span className="text-xs font-normal text-slate-500">{a.um ?? ""}</span></td>
                </tr>
                {abierto === a.clave && (
                  <tr>
                    <td colSpan={5} className="bg-slate-50 px-3 py-3">
                      {a.ventas.length === 0 ? (
                        <p className="text-sm text-slate-500">No hay ventas de este artículo desde el corte del kárdex.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="text-xs text-slate-500">
                            <tr><th className="py-1 text-left font-medium">Fecha</th><th className="py-1 text-left font-medium">Factura</th><th className="py-1 text-left font-medium">Cliente</th><th className="py-1 text-left font-medium">Vendedor</th><th className="py-1 text-right font-medium">Cantidad</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {a.ventas.map((v, i) => (
                              <tr key={i}>
                                <td className="py-1 text-slate-600">{f(v.fecha)}</td>
                                <td className="py-1 font-medium">{v.factura ?? "Sin factura"}</td>
                                <td className="py-1">{v.cliente}</td>
                                <td className="py-1 text-slate-600">{v.vendedor}</td>
                                <td className="py-1 text-right tabular-nums">−{n(v.cantidad)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {lista.length === 0 && <p className="px-4 py-6 text-sm text-slate-500">Ningún artículo coincide.</p>}
      </Card>
      {lista.length > 600 && <p className="text-xs text-slate-500">Se muestran los primeros 600. Usa el buscador para encontrar otros.</p>}
    </div>
  );
}
