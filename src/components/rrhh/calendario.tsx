"use client";

import { useRef, useState, useTransition } from "react";
import { calendarioRhAction } from "@/actions/rrhh";
import { Spinner } from "@/components/ui";
import { ROL_LABEL } from "@/lib/ops/roles";
import { DIAS_SEMANA, ESTADO_LABEL, fechaRh, MESES_LARGOS, rangoRh, semanasDelMes, type EventoCal } from "@/lib/rrhh";
import type { Rol } from "@/lib/auth/route-guard";

const puestoTxt = (p: string | null) => (p ? (ROL_LABEL[p as Rol] ?? p) : "");

/** Mes en cuadricula: festivos, temporadas generales (dias que se descuentan) y quien esta fuera.
 *  Los demas solo ven el puesto; la gerente (y el jefe de su equipo) ven el nombre. */
export function CalendarioRh({ mes: mesIni, eventos: evIni, hoy, sabadoLaborable }: { mes: string; eventos: EventoCal[]; hoy: string; sabadoLaborable: boolean }) {
  // Cambiar de mes no recarga la pagina (no se pierde lo que se este llenando arriba).
  const [mes, setMes] = useState(mesIni);
  const [eventos, setEventos] = useState(evIni);
  const [cargando, start] = useTransition();
  const cache = useRef<Record<string, EventoCal[]>>({ [mesIni]: evIni });
  const ir = (nuevo: string) => {
    setMes(nuevo);
    if (cache.current[nuevo]) return setEventos(cache.current[nuevo]);
    start(async () => {
      const r = await calendarioRhAction(nuevo);
      if (r) cache.current[nuevo] = r;
      setEventos(r ?? []);
    });
  };
  const [y, m] = mes.split("-").map(Number);
  const semanas = semanasDelMes(y, m - 1);
  const mover = (d: number) => {
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const del = (dia: string) => eventos.filter((e) => e.desde <= dia && e.hasta >= dia);
  const quien = (e: EventoCal) => (e.mio ? "Tú" : e.nombre ?? puestoTxt(e.puesto));
  const gente = eventos.filter((e) => e.clase === "vacaciones" || e.clase === "permiso").sort((a, b) => a.desde.localeCompare(b.desde));
  const fijos = eventos.filter((e) => e.clase === "festivo" || e.clase === "temporada" || e.clase === "bloqueo").sort((a, b) => a.desde.localeCompare(b.desde));

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => ir(mover(-1))} className="rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-50" aria-label="Mes anterior">‹</button>
        <h2 className="flex items-center gap-2 text-base font-semibold">{MESES_LARGOS[m - 1]} {y}{cargando && <Spinner className="h-4 w-4 text-slate-400" />}</h2>
        <button type="button" onClick={() => ir(mover(1))} className="rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-50" aria-label="Mes siguiente">›</button>
      </div>
      <div className={`grid grid-cols-7 gap-px overflow-hidden rounded-lg transition-opacity ${cargando ? "opacity-60" : ""} border border-slate-200 bg-slate-200 text-xs`}>
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="bg-slate-50 py-1 text-center font-semibold text-slate-500">{d}</div>
        ))}
        {semanas.flat().map((dia, i) => {
          if (!dia) return <div key={i} className="min-h-16 bg-slate-50/60 sm:min-h-20" />;
          const ev = del(dia);
          const fest = ev.find((e) => e.clase === "festivo");
          const temp = ev.find((e) => e.clase === "temporada");
          const bloq = ev.find((e) => e.clase === "bloqueo");
          const desc = !!temp?.descuento?.includes(dia);
          const dow = i % 7;
          const descanso = dow === 6 || (dow === 5 && !sabadoLaborable);
          const ppl = ev.filter((e) => e.clase === "vacaciones" || e.clase === "permiso");
          const bg = fest ? "bg-red-50" : temp ? (desc ? "bg-violet-200" : "bg-emerald-50") : bloq ? "bg-slate-100" : descanso ? "bg-slate-50" : "bg-white";
          return (
            <div key={i} className={`min-h-16 min-w-0 p-1 sm:min-h-20 ${bg}`}>
              <div className={`flex items-center justify-between ${dia === hoy ? "font-bold text-brand-700" : descanso ? "text-slate-400" : "text-slate-700"}`}>
                <span className={dia === hoy ? "rounded-full bg-brand-600 px-1.5 text-white" : ""}>{Number(dia.slice(8))}</span>
              </div>
              {fest && <p className="truncate text-[10px] font-semibold text-red-700" title={fest.titulo}>{fest.titulo}</p>}
              {temp && (desc ? <p className="truncate text-[10px] font-bold text-violet-900" title={temp.titulo}>Se descuenta</p> : <p className="truncate text-[10px] font-medium text-emerald-700" title={temp.titulo}>{descanso || fest ? temp.titulo : "Lo da la empresa"}</p>)}
              {bloq && <p className="truncate text-[10px] font-semibold text-slate-600" title={bloq.titulo}>Sin vacaciones</p>}
              {ppl.slice(0, 2).map((e, k) => (
                <p key={k} title={`${e.titulo} · ${quien(e)}`} className={`mt-0.5 truncate rounded px-1 text-[10px] ${e.mio ? "bg-brand-600 text-white" : e.estado === "aprobada" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                  {quien(e)}
                </p>
              ))}
              {ppl.length > 2 && <p className="text-[10px] text-slate-500">+{ppl.length - 2}</p>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-200 align-middle" />Festivo</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-violet-300 align-middle" />Vacaciones generales: se descuenta</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-200 align-middle" />Vacaciones generales: lo da la empresa</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-slate-300 align-middle" />Sin vacaciones</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-green-200 align-middle" />Autorizado</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-200 align-middle" />En espera</span>
      </div>
      {(fijos.length > 0 || gente.length > 0) && (
        <ul className="divide-y divide-slate-100 text-sm">
          {fijos.map((e, k) => (
            <li key={`f${k}`} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span className={e.clase === "festivo" ? "font-medium text-red-700" : e.clase === "bloqueo" ? "font-medium text-slate-700" : "font-medium text-violet-800"}>{e.clase === "festivo" ? "Festivo: " : e.clase === "bloqueo" ? "Sin vacaciones: " : "Vacaciones generales: "}{e.titulo}</span>
              <span className="text-slate-500">
                {rangoRh(e.desde, e.hasta)}
                {e.clase === "temporada" && ` · se descuentan ${e.descuento?.length ?? 0} días${e.descuento?.length ? ` (${e.descuento.map((d) => fechaRh(d, false)).join(", ")})` : ""}`}
              </span>
            </li>
          ))}
          {gente.map((e, k) => (
            <li key={`g${k}`} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span><b>{quien(e)}</b> · {e.titulo}</span>
              <span className="text-slate-500">{rangoRh(e.desde, e.hasta)} · {e.estado ? ESTADO_LABEL[e.estado] : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
