"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LeadStats } from "@/lib/leads/stats";

// Misma paleta que las estadisticas del comprador: azul, naranja y un tercer tono neutro.
const BLUE = "#2a78d6";
const ORANGE = "#eb6834";
const TEAL = "#1f9e89";
const GREEN = "#2f9e44";
const LOST = "#c4c9d2";
const GRID = "#e5e7eb";
const INK = "#52514e";
const tick = { fill: INK, fontSize: 12 };

function Box({ title, subtitle, children, empty }: { title: string; subtitle?: string; children: React.ReactNode; empty: boolean }) {
  return (
    <figure className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <figcaption className="mb-3">
        <span className="text-sm font-medium text-slate-800">{title}</span>
        {subtitle && <span className="block text-xs text-slate-500">{subtitle}</span>}
      </figcaption>
      {empty ? <p className="py-10 text-center text-sm text-slate-500">Todavía no hay datos.</p> : <div className="h-60">{children}</div>}
    </figure>
  );
}

const shortWeek = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
};
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const shortMonth = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;

/** Leads por etapa: las abiertas en azul, ganado en verde y perdido en gris. */
export function StageChart({ data }: { data: LeadStats["porEtapa"] }) {
  const empty = data.every((d) => d.count === 0);
  return (
    <Box title="Leads por etapa" subtitle="Dónde está cada prospecto hoy" empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 28 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={88} tick={tick} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(v) => [String(v), "Leads"]} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.etapa} fill={d.etapa === "ganado" ? GREEN : d.etapa === "perdido" ? LOST : BLUE} />
            ))}
            <LabelList dataKey="count" position="right" fill={INK} fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function WeeklyActivityChart({ data }: { data: LeadStats["actividadSemanal"] }) {
  const empty = data.every((d) => d.llamadas + d.mensajes + d.visitas === 0);
  return (
    <Box title="Contactos por semana" subtitle="Llamadas, mensajes (WhatsApp y correo) y visitas" empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ right: 8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="semana" tickFormatter={shortWeek} tick={tick} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={28} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} labelFormatter={(l) => `Semana del ${shortWeek(String(l))}`} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="llamadas" name="Llamadas" stackId="a" fill={BLUE} maxBarSize={32} />
          <Bar dataKey="mensajes" name="Mensajes" stackId="a" fill={ORANGE} maxBarSize={32} />
          <Bar dataKey="visitas" name="Visitas" stackId="a" fill={TEAL} radius={[4, 4, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function MonthlyChart({ data }: { data: LeadStats["porMes"] }) {
  const empty = data.every((d) => d.nuevos + d.ganados === 0);
  return (
    <Box title="Nuevos prospectos vs. convertidos a cliente" subtitle="Últimos 6 meses" empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ right: 8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="mes" tickFormatter={shortMonth} tick={tick} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={28} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} labelFormatter={(l) => shortMonth(String(l))} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="nuevos" name="Nuevos" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={24} />
          <Bar dataKey="ganados" name="Ganados" fill={GREEN} radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function SourceChart({ data }: { data: LeadStats["porOrigen"] }) {
  return (
    <Box title="¿De dónde vienen?" subtitle="Leads por origen y cuántos se volvieron clientes" empty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 12 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={104} tick={tick} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="count" name="Leads" fill={BLUE} radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={false} />
          <Bar dataKey="ganados" name="Clientes" fill={GREEN} radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
