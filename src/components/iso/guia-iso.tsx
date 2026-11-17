"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ESTADO_ISO, ISO_9001, ISO_INTRO, resumenIso, type EstadoIso } from "@/lib/iso9001";

const quita = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function GuiaIso() {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<EstadoIso | "todos">("todos");
  const r = resumenIso();
  const caps = useMemo(() => {
    const t = quita(q.trim());
    return ISO_9001.map((c) => ({
      ...c,
      requisitos: c.requisitos.filter((x) =>
        (estado === "todos" || x.estado === estado) &&
        (!t || quita(`${x.num} ${x.titulo} ${x.pide} ${x.pendiente ?? ""} ${x.evidencia.map((e) => e.texto).join(" ")} ${c.titulo}`).includes(t))),
    })).filter((c) => c.requisitos.length);
  }, [q, estado]);

  const chip = (k: EstadoIso | "todos", label: string, n: number) => (
    <button key={k} type="button" onClick={() => setEstado(k)}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${estado === k ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-brand-50"}`}>
      {label} <span className="opacity-70">({n})</span>
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        {([["portal", r.portal], ["parcial", r.parcial], ["fuera", r.fuera], ["no_aplica", r.no_aplica]] as [EstadoIso, number][]).map(([k, n]) => (
          <div key={k} className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <p className="text-3xl font-bold text-slate-900">{n}<span className="text-base font-medium text-slate-400"> / {r.total}</span></p>
            <p className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${ESTADO_ISO[k].cls}`}>{ESTADO_ISO[k].label}</p>
            <p className="mt-1 text-xs text-slate-500">{ESTADO_ISO[k].ayuda}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: proveedores, quejas, 8.4, auditoría..." className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm sm:max-w-sm" />
        <div className="flex flex-wrap gap-2">
          {chip("todos", "Todos", r.total)}
          {chip("portal", "En el portal", r.portal)}
          {chip("parcial", "Parcial", r.parcial)}
          {chip("fuera", "Fuera del portal", r.fuera)}
        </div>
      </div>

      {!q && estado === "todos" && (
        <details className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-brand-900">Capítulos {ISO_INTRO.num}: {ISO_INTRO.titulo}</summary>
          <p className="mt-2 text-sm text-slate-700">{ISO_INTRO.idea}</p>
        </details>
      )}

      {caps.map((c) => (
        <section key={c.num} className="space-y-2">
          <div className="flex items-baseline gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-700 to-brand-500 text-sm font-bold text-white">{c.num}</span>
            <div>
              <h2 className="text-lg font-bold text-brand-950">{c.titulo}</h2>
              <p className="text-sm text-slate-600">{c.idea}</p>
            </div>
          </div>
          <div className="space-y-2">
            {c.requisitos.map((x) => (
              <details key={x.num} className="group rounded-xl border border-slate-200/80 bg-white shadow-sm open:ring-1 open:ring-brand-200" open={!!q}>
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                  <span className="w-20 shrink-0 font-mono text-sm font-semibold text-brand-700">{x.num}</span>
                  <span className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{x.titulo}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${ESTADO_ISO[x.estado].cls}`}>{ESTADO_ISO[x.estado].label}</span>
                  <span className="text-slate-400 transition group-open:rotate-90" aria-hidden>›</span>
                </summary>
                <div className="space-y-3 border-t border-slate-100 px-4 py-3 text-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Qué pide (en sencillo)</p>
                    <p className="mt-0.5 text-slate-800">{x.pide}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidencia en ESC</p>
                    <ul className="mt-1 space-y-1">
                      {x.evidencia.map((e) => (
                        <li key={e.texto} className="flex items-start gap-2 text-slate-800">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
                          {e.href ? <Link href={e.href} className="font-medium text-brand-700 hover:underline">{e.texto}</Link> : <span>{e.texto}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {x.pendiente && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"><span className="font-semibold">Por hacer: </span>{x.pendiente}</p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
      {!caps.length && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No hay cláusulas con esa búsqueda.</p>}
    </div>
  );
}
