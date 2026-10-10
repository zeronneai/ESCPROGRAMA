"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface CostPoint {
  fecha: string;
  costo: number;
  moneda: "MXN" | "USD";
  proveedor: string | null;
  producto: string;
  version: number;
}

const BLUE = "#2a78d6";
const GRID = "#e5e7eb";
const INK = "#52514e";

/** Costo del producto en el tiempo. Una sola moneda a la vez (nunca se mezclan en un eje). */
export function CostHistoryChart({ points }: { points: CostPoint[] }) {
  const currencies = [...new Set(points.map((p) => p.moneda))];
  const [cur, setCur] = useState<"MXN" | "USD">(currencies[0] ?? "MXN");
  const active = currencies.includes(cur) ? cur : (currencies[0] ?? "MXN");
  const data = points.filter((p) => p.moneda === active).map((p) => ({ ...p, t: new Date(p.fecha).getTime() }));

  return (
    <figure className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
        <span>Costo del producto en el tiempo ({active})</span>
        {currencies.length > 1 && (
          <span className="flex gap-1 text-xs">
            {currencies.map((c) => (
              <button key={c} onClick={() => setCur(c)} className={`rounded px-2 py-1 ${c === active ? "bg-brand-600 text-white" : "border border-slate-300"}`}>{c}</button>
            ))}
          </span>
        )}
      </figcaption>
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">Sin datos de costo para este producto.</p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ right: 12 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false}
                tickFormatter={(t: number) => new Date(t).toLocaleDateString("es-MX", { month: "short", year: "2-digit" })} />
              <YAxis tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false} width={60} />
              <Tooltip
                labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("es-MX", { dateStyle: "medium" })}
                formatter={(v, _n, item) => [`$${Number(v).toFixed(2)} ${active}`, (item.payload as CostPoint).proveedor ?? "Sin proveedor"]}
              />
              <Line type="monotone" dataKey="costo" name="Costo" stroke={BLUE} strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <details className="mt-2 text-xs text-slate-600">
        <summary className="cursor-pointer">Ver tabla</summary>
        <table className="mt-1 w-full text-left">
          <thead><tr><th>Fecha</th><th>Producto</th><th>Costo</th><th>Proveedor</th></tr></thead>
          <tbody>
            {data.map((p, i) => (
              <tr key={i}><td>{new Date(p.fecha).toLocaleDateString("es-MX")}</td><td>{p.producto}</td><td className="tabular-nums">${p.costo.toFixed(2)}</td><td>{p.proveedor ?? "-"}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
