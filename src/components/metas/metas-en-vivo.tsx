"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EVENTO_CAMBIO } from "@/components/realtime-sync";
import { colorAvance, normalizarAvance, ritmoDe, type AvanceMeta } from "@/lib/metas-venta";
import { createClient } from "@/lib/supabase/client";

const COLORES = {
  verde: { trazo: "#16a34a", suave: "#dcfce7", texto: "text-green-700" },
  ambar: { trazo: "#f59e0b", suave: "#fef3c7", texto: "text-amber-700" },
  rojo: { trazo: "#dc2626", suave: "#fee2e2", texto: "text-red-700" },
};
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;
const pctTxt = (n: number) => `${n.toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`;

/** Anillo de avance con una marca donde deberia ir segun los dias del mes. */
function Anillo({ pct, ritmo, tam = 150, grosor = 14, children }: { pct: number; ritmo: number; tam?: number; grosor?: number; children?: React.ReactNode }) {
  const r = (tam - grosor) / 2;
  const circ = 2 * Math.PI * r;
  const c = COLORES[colorAvance(pct, ritmo)];
  const lleno = Math.min(pct, 100) / 100;
  const ang = (Math.min(ritmo, 100) / 100) * 2 * Math.PI - Math.PI / 2;
  const mx = tam / 2 + r * Math.cos(ang);
  const my = tam / 2 + r * Math.sin(ang);
  return (
    <div className="relative" style={{ width: tam, height: tam }}>
      <svg width={tam} height={tam} viewBox={`0 0 ${tam} ${tam}`} aria-hidden>
        <circle cx={tam / 2} cy={tam / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={grosor} />
        <circle
          cx={tam / 2}
          cy={tam / 2}
          r={r}
          fill="none"
          stroke={c.trazo}
          strokeWidth={grosor}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - lleno)}
          transform={`rotate(-90 ${tam / 2} ${tam / 2})`}
          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1), stroke .6s" }}
        />
        {ritmo > 0 && ritmo < 100 && <circle cx={mx} cy={my} r={grosor / 2 - 2} fill="#0f172a" stroke="#fff" strokeWidth={2} />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function MetasEnVivo({ inicial, publico: token }: { inicial: AvanceMeta[]; /** Pantalla publica: sin usuario. */ publico?: boolean }) {
  const [filas, setFilas] = useState(inicial);
  const [act, setAct] = useState(() => Date.now());
  const [ahora, setAhora] = useState(() => Date.now());
  const [festejo, setFestejo] = useState<{ nombre: string; pct: number } | null>(null);
  const [brillo, setBrillo] = useState<Set<string>>(new Set());
  const previo = useRef(new Map(inicial.map((f) => [f.id, f.pct])));
  const caja = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    const { data, error } = token ? await createClient().rpc("metas_ventas_publico") : await createClient().rpc("metas_ventas_avance");
    if (error || !data) return;
    const nuevas = normalizarAvance(data as Record<string, unknown>[]);
    const subieron = nuevas.filter((f) => f.pct > (previo.current.get(f.id) ?? f.pct));
    if (subieron.length) {
      const top = subieron.sort((a, b) => b.pct - a.pct)[0];
      setFestejo({ nombre: top.nombre, pct: top.pct });
      setBrillo(new Set(subieron.map((f) => f.id)));
      window.setTimeout(() => setFestejo(null), 6000);
      window.setTimeout(() => setBrillo(new Set()), 3000);
    }
    previo.current = new Map(nuevas.map((f) => [f.id, f.pct]));
    setFilas(nuevas);
    setAct(Date.now());
  }, [token]);

  useEffect(() => {
    const sb = createClient();
    let t: number | undefined;
    const pronto = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => void cargar(), 600);
    };
    const canal = sb.channel("metas-ventas").on("postgres_changes", { event: "*", schema: "public", table: "ventas_pulso" }, pronto).subscribe();
    const on = (e: Event) => {
      const d = (e as CustomEvent<string>).detail;
      if (d === "ventas" || d === "ventas_pulso") pronto();
    };
    window.addEventListener(EVENTO_CAMBIO, on);
    const respaldo = window.setInterval(() => document.visibilityState === "visible" && void cargar(), 30_000);
    const reloj = window.setInterval(() => setAhora(Date.now()), 15_000);
    // En las teles: recarga la pagina cada 6 horas para tomar cambios del portal.
    const recarga = token ? window.setTimeout(() => window.location.reload(), 6 * 3600_000) : undefined;
    return () => {
      window.clearTimeout(t);
      window.clearInterval(respaldo);
      window.clearInterval(reloj);
      window.clearTimeout(recarga);
      window.removeEventListener(EVENTO_CAMBIO, on);
      void sb.removeChannel(canal);
    };
  }, [cargar, token]);

  if (!filas.length) return <p className="rounded-xl bg-white p-6 text-center text-slate-500 shadow-sm">No hay metas activas este mes.</p>;
  const f0 = filas[0];
  const ritmo = ritmoDe(f0.dia, f0.dias_mes);
  const mes = MESES[Number(f0.mes.slice(5, 7)) - 1];
  const diaDe = (d?: string | null) => (d ? Number(d.slice(8, 10)) : 0);
  const fin = f0.hasta ?? null;
  const rango = f0.desde && fin && (diaDe(f0.desde) !== 1 || diaDe(fin) < 28) ? `del ${diaDe(f0.desde)} al ${diaDe(fin)} de ${mes}` : null;
  const equipo = f0.equipo_pct ?? 0;
  const conMontos = filas.some((f) => f.meta != null && !f.es_mio);
  const totVend = filas.reduce((s, f) => s + (f.vendido ?? 0), 0);
  const totMeta = filas.reduce((s, f) => s + (f.meta ?? 0), 0);
  const seg = Math.round((ahora - act) / 1000);
  // Casa Local no es un vendedor: va junto a la meta del equipo, fuera del ranking.
  const esCasa = (f: AvanceMeta) => /casa\s*local/i.test(f.nombre);
  const casa = filas.find(esCasa) ?? null;
  const orden = filas.filter((f) => !esCasa(f)).sort((a, b) => b.pct - a.pct);

  return (
    <div ref={caja} className="space-y-5 bg-[#eef3fb] [&:fullscreen]:overflow-y-auto [&:fullscreen]:p-6">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Metas de venta · <span className="capitalize">{mes}</span></h1>
          {rango && <p className="text-sm font-medium text-slate-700">Periodo {rango} · la meta es proporcional a esos días</p>}
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
            <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-600" /></span>
            En vivo · actualizado {seg < 20 ? "hace un momento" : `hace ${seg < 60 ? `${seg} s` : `${Math.round(seg / 60)} min`}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : caja.current?.requestFullscreen())} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50">
          Pantalla completa
        </button>
        </div>
      </div>

      {/* Equipo (y Casa Local en el mismo renglon) */}
      <div className={`grid grid-cols-1 gap-3 ${casa ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : ""}`}>
      <div className="flex flex-col items-center gap-5 rounded-2xl bg-white p-5 shadow-sm sm:flex-row sm:gap-8">
        <Anillo pct={equipo} ritmo={ritmo} tam={190} grosor={18}>
          <span className="text-4xl font-extrabold tabular-nums text-slate-900">{pctTxt(equipo)}</span>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Equipo</span>
        </Anillo>
        <div className="w-full flex-1 space-y-3">
          <div>
            <p className="text-sm text-slate-600">{rango ? "Avance del periodo" : "Avance del mes"}</p>
            <div className="relative mt-1 h-4 overflow-hidden rounded-full bg-slate-200">
              <div className="h-4 rounded-full bg-slate-400" style={{ width: `${ritmo}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500">Día {f0.dia} de {f0.dias_mes}{rango ? " del periodo" : ""}: para ir al ritmo deberían llevar <b>{pctTxt(ritmo)}</b> (el punto negro en cada gráfica).</p>
          </div>
          {conMontos && (
            <p className="text-lg font-semibold tabular-nums text-slate-800">
              {pesos(totVend)} <span className="text-sm font-normal text-slate-500">de {pesos(totMeta)}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-green-600" /> Al ritmo o arriba</span>
            <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Cerca</span>
            <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-red-600" /> Atrasado</span>
          </div>
        </div>
      </div>

      {casa && (() => {
        const c = COLORES[colorAvance(casa.pct, ritmo)];
        return (
          <div className={`flex flex-col items-center justify-center gap-2 rounded-2xl bg-white p-5 shadow-sm transition-all duration-700 ${brillo.has(casa.id) ? "scale-[1.02] ring-4 ring-green-300" : ""}`}>
            <Anillo pct={casa.pct} ritmo={ritmo} tam={170} grosor={16}>
              <span className={`text-3xl font-extrabold tabular-nums ${c.texto}`}>{pctTxt(casa.pct)}</span>
              {casa.pct >= 100 && <span className="text-xs font-semibold text-green-700">¡Meta!</span>}
            </Anillo>
            <p className="text-center text-base font-bold text-slate-900">{casa.nombre}</p>
            {casa.meta != null && casa.vendido != null && <p className="text-center text-xs tabular-nums text-slate-500">{pesos(casa.vendido)} de {pesos(casa.meta)}</p>}
          </div>
        );
      })()}
      </div>

      {/* Por vendedor */}
      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${token ? "2xl:grid-cols-8" : ""}`}>
        {orden.map((f, i) => {
          const c = COLORES[colorAvance(f.pct, ritmo)];
          return (
            <div
              key={f.id}
              className={`flex flex-col items-center gap-2 rounded-2xl bg-white p-4 shadow-sm transition-all duration-700 ${brillo.has(f.id) ? "scale-[1.03] ring-4 ring-green-300" : ""} ${f.es_mio ? "ring-2 ring-brand-400" : ""}`}
            >
              <div className="flex w-full items-center justify-between text-xs text-slate-500">
                <span className="font-semibold">#{i + 1}</span>
                {f.pct >= 100 && <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-800">¡Meta!</span>}
              </div>
              <Anillo pct={f.pct} ritmo={ritmo} tam={130} grosor={12}>
                <span className={`text-2xl font-extrabold tabular-nums ${c.texto}`}>{pctTxt(f.pct)}</span>
              </Anillo>
              <p className="text-center text-sm font-semibold leading-tight text-slate-900">{f.nombre}{f.es_mio && <span className="block text-[11px] font-normal text-brand-700">Tú</span>}</p>
              {f.meta != null && f.vendido != null && <p className="text-center text-[11px] tabular-nums text-slate-500">{pesos(f.vendido)} de {pesos(f.meta)}{f.meta_mes && Math.abs(f.meta_mes - f.meta) > 1 ? ` (del mes ${pesos(f.meta_mes)})` : ""}</p>}
              {!token && !f.vendedor_id && <p className="text-center text-[11px] text-slate-400">Ventas capturadas a mano</p>}
            </div>
          );
        })}
      </div>

      {/* Ranking en barras */}
      <div className="space-y-2 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Ranking</h2>
        <div className="relative space-y-2.5">
          {orden.map((f) => {
            const c = COLORES[colorAvance(f.pct, ritmo)];
            return (
              <div key={f.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-sm sm:grid-cols-[11rem_minmax(0,1fr)_4rem]">
                <span className="truncate font-medium text-slate-800">{f.nombre}</span>
                <div className="relative h-5 rounded-full" style={{ background: c.suave }}>
                  <div className="h-5 rounded-full" style={{ width: `${Math.min(f.pct, 100)}%`, background: c.trazo, transition: "width 1.2s cubic-bezier(.2,.8,.2,1)" }} />
                  <div className="absolute inset-y-[-3px] w-0.5 bg-slate-900" style={{ left: `${Math.min(ritmo, 100)}%` }} title="Ritmo esperado" />
                </div>
                <span className={`text-right font-bold tabular-nums ${c.texto}`}>{pctTxt(f.pct)}</span>
              </div>
            );
          })}
        </div>
      </div>
      {filas.some((f) => f.usd_sin_tc) && <p className="text-xs text-amber-700">Hay ventas en dólares sin tipo de cambio: todavía no suman.</p>}
      <p className="text-xs text-slate-500">Todo es sin IVA. Cuenta lo registrado en Ventas diarias del mes (sin canceladas) y lo capturado a mano para quien no tiene usuario. Las ventas en dólares se pasan a pesos con el tipo de cambio de su factura (o el de Banxico de ese día).</p>

      {festejo && (
        <div className="toast-in fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-2xl bg-green-600 px-5 py-3 text-center text-white shadow-2xl sm:bottom-8">
          <p className="text-sm">🎉 Nueva venta</p>
          <p className="text-lg font-bold">{festejo.nombre} ya va en {pctTxt(festejo.pct)}</p>
        </div>
      )}
    </div>
  );
}
