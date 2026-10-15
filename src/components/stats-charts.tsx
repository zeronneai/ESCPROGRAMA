"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Conversion, Count } from "@/lib/stats/buyer-stats";

// Paleta categorica validada: slot 1 azul, slot 2 naranja (ver skill dataviz).
const BLUE = "#2a78d6";
const ORANGE = "#eb6834";
const GRID = "#e5e7eb";
const INK = "#52514e";

function Box({ title, children, empty }: { title: string; children: React.ReactNode; empty: boolean }) {
  return (
    <figure className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <figcaption className="mb-2 text-sm font-medium text-slate-800">{title}</figcaption>
      {empty ? <p className="py-10 text-center text-sm text-slate-500">Sin datos en este rango.</p> : <div className="h-60">{children}</div>}
    </figure>
  );
}

function DataTable({ rows, cols }: { rows: Array<Record<string, string | number>>; cols: [string, string][] }) {
  return (
    <details className="mt-2 text-xs text-slate-600">
      <summary className="cursor-pointer">Ver tabla</summary>
      <table className="mt-1 w-full text-left">
        <thead>
          <tr>
            {cols.map(([, h]) => (
              <th key={h} className="pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map(([k]) => (
                <td key={k} className="pr-3 tabular-nums">
                  {r[k]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function CountBar({ title, data, horizontal = false }: { title: string; data: Count[]; horizontal?: boolean }) {
  const rows = data.slice(0, 12).map((d) => ({ label: d.label, count: d.count }));
  return (
    <div>
      <Box title={title} empty={rows.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout={horizontal ? "vertical" : "horizontal"} margin={{ left: horizontal ? 24 : 0, right: 12 }}>
            <CartesianGrid stroke={GRID} vertical={!horizontal} horizontal={horizontal ? false : true} />
            {horizontal ? (
              <>
                <XAxis type="number" allowDecimals={false} tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={110} tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false} />
              </>
            ) : (
              <>
                <XAxis dataKey="label" tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false} />
              </>
            )}
            <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(v) => [String(v), "Partidas"]} />
            <Bar dataKey="count" name="Partidas" fill={BLUE} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={28} isAnimationActive={!horizontal} />
          </BarChart>
        </ResponsiveContainer>
      </Box>
      <DataTable rows={rows} cols={[["label", "Categoria"], ["count", "Partidas"]]} />
    </div>
  );
}

export function WeeklyTrend({ data }: { data: { semana: string; enviadas: number; respondidas: number }[] }) {
  return (
    <div>
      <Box title="Tendencia semanal (semana que inicia el lunes)" empty={data.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ right: 12 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="semana" tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="enviadas" name="Partidas enviadas" stroke={BLUE} strokeWidth={2} dot={{ r: 4 }} />
            <Line type="monotone" dataKey="respondidas" name="Respondidas" stroke={ORANGE} strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </Box>
      <DataTable
        rows={data}
        cols={[["semana", "Semana"], ["enviadas", "Enviadas"], ["respondidas", "Respondidas"]]}
      />
    </div>
  );
}

/** Tasa de conversion (ganadas entre enviadas con resultado) por grupo. */
export function RateBar({ title, data }: { title: string; data: Conversion[] }) {
  const rows = data.slice(0, 12).map((d) => ({ label: d.label, tasa: d.tasa === null ? 0 : Math.round(d.tasa * 1000) / 10, enviadas: d.enviadas, ganadas: d.ganadas, perdidas: d.perdidas, sin: d.tasa === null }));
  return (
    <div>
      <Box title={title} empty={rows.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ right: 12 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} unit="%" tick={{ fill: INK, fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "#f1f5f9" }}
              formatter={(v, _n, item) => {
                const p = item.payload as (typeof rows)[number];
                return [p.sin ? "Sin resultados aún" : `${v}% (${p.ganadas} ganadas, ${p.perdidas} perdidas)`, "Conversión"];
              }}
            />
            <Bar dataKey="tasa" name="Conversión" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </Box>
      <DataTable
        rows={rows.map((r) => ({ label: r.label, enviadas: r.enviadas, ganadas: r.ganadas, perdidas: r.perdidas, tasa: r.sin ? "-" : `${r.tasa}%` }))}
        cols={[["label", "Grupo"], ["enviadas", "Enviadas"], ["ganadas", "Ganadas"], ["perdidas", "Perdidas"], ["tasa", "Conversión"]]}
      />
    </div>
  );
}
