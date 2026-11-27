"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { colorAvance, normalizarAvance, ritmoDe, type AvanceMeta } from "@/lib/metas-venta";
import { createClient } from "@/lib/supabase/client";
import { MascotaMetas } from "./mascota";
import { Anillo, COLORES, pctTxt } from "./metas-en-vivo";

export interface ExtraPantalla {
  ventas: { quien: string; at: string }[];
  cierres: { quien: string; at: string }[];
  diario: { fecha: string; pct: number }[];
  hoy: { ventas: number; prospectos: number; cierres: number };
  ahora?: string;
}
const VACIO: ExtraPantalla = { ventas: [], cierres: [], diario: [], hoy: { ventas: 0, prospectos: 0, cierres: 0 } };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const CATALOGO = ["01", ...Array.from({ length: 34 }, (_, i) => String(i + 5).padStart(2, "0"))];
const SEG = 12;

const CONSEJOS = [
  "Pregunta antes de ofrecer: ¿qué problema quiere resolver el cliente?",
  "Da seguimiento el mismo día: una cotización sin llamada se enfría.",
  "Ofrece la muestra: tocar el guante vende más que la ficha técnica.",
  "Habla del costo por uso, no solo del precio por caja.",
  "Pregunta cada cuánto compran: ahí está la venta recurrente.",
  "Un cliente contento te da otro cliente: pide la recomendación.",
  "Anota en la bitácora en cuanto cuelgas: la memoria falla, el portal no.",
  "Si el cliente dice 'está caro', pregunta '¿comparado con qué?'.",
  "Vende la entrega a tiempo: en planta, un paro cuesta más que el producto.",
  "Conoce la talla y el uso: el guante correcto evita devoluciones.",
  "Cierra con una fecha: '¿se lo entrego el martes o el jueves?'.",
  "Revisa a quién no le has vendido este mes y márcale hoy.",
  "Un 'no' de hoy es un 'tal vez' en tres meses: déjalo en la bitácora.",
  "Lleva el catálogo: que el cliente vea todo lo que le podemos surtir.",
  "Escucha más de lo que hablas: el cliente te dice cómo venderle.",
];
const FRASES = [
  "¡Cada factura cuenta! Súbela a Ventas diarias.",
  "Hoy es buen día para cerrar ese prospecto 📞",
  "¡Una venta más y subimos en la gráfica! 🚀",
  "El que persevera, alcanza la meta 💪",
  "Somos equipo: la meta es de todos 🤝",
  "Un cliente bien atendido regresa solo ✨",
];

const haceTxt = (iso: string, ahora: number) => {
  const m = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000));
  if (m < 1) return "hace un momento";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
};

function useVentana() {
  const [v, setV] = useState({ w: 1920, h: 1080 });
  useEffect(() => {
    const f = () => setV({ w: window.innerWidth, h: window.innerHeight });
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return v;
}

/** Grafica de area: avance acumulado del equipo dia por dia contra el ritmo esperado. */
function GraficaDiaria({ diario, dias }: { diario: ExtraPantalla["diario"]; dias: number }) {
  const W = 520, H = 300, P = 30, PL = 46;
  if (!diario.length) return <p className="text-center text-slate-500">Todavía no hay ventas en el periodo.</p>;
  const max = Math.max(100, ...diario.map((d) => d.pct));
  const x = (i: number) => PL + (i / Math.max(1, dias - 1)) * (W - PL - P);
  const y = (p: number) => H - P - (p / max) * (H - 2 * P);
  const linea = diario.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.pct).toFixed(1)}`).join(" ");
  const area = `${linea} L${x(diario.length - 1).toFixed(1)},${H - P} L${x(0).toFixed(1)},${H - P} Z`;
  const ult = diario[diario.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" aria-label="Avance del equipo día por día">
      <defs>
        <linearGradient id="tv-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2563eb" stopOpacity=".35" /><stop offset="1" stopColor="#2563eb" stopOpacity="0" /></linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={PL} x2={W - P} y1={y(g)} y2={y(g)} stroke="#e2e8f0" strokeWidth="1" />
          <text x={PL - 8} y={y(g) + 5} textAnchor="end" fontSize="14" fill="#64748b">{g}%</text>
        </g>
      ))}
      <line x1={x(0)} y1={y(100 / dias)} x2={x(dias - 1)} y2={y(100)} stroke="#0f172a" strokeWidth="2" strokeDasharray="6 5" opacity=".55" />
      <path d={area} fill="url(#tv-area)" />
      <path d={linea} fill="none" stroke="#2563eb" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(diario.length - 1)} cy={y(ult.pct)} r="7" fill="#2563eb" stroke="#fff" strokeWidth="3">
        <animate attributeName="r" values="7;10;7" dur="1.6s" repeatCount="indefinite" />
      </circle>
      <text x={Math.min(x(diario.length - 1) + 12, W - 60)} y={y(ult.pct) - 10} fontSize="16" fontWeight="800" fill="#1d4ed8">{pctTxt(ult.pct)}</text>
    </svg>
  );
}

/** Pantalla de las teles: todo en una sola vista (sin scroll) y en constante cambio. */
export function PantallaTV({ inicial, extraInicial }: { inicial: AvanceMeta[]; extraInicial: ExtraPantalla | null }) {
  const [filas, setFilas] = useState(inicial);
  const [extra, setExtra] = useState<ExtraPantalla>(extraInicial ?? VACIO);
  const [ahora, setAhora] = useState(() => Date.now());
  const [slide, setSlide] = useState(0);
  const [pag, setPag] = useState(0);
  const [consejo, setConsejo] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const [brillo, setBrillo] = useState<Set<string>>(new Set());
  const previo = useRef(new Map(inicial.map((f) => [f.id, f.pct])));
  const ultVenta = useRef(extraInicial?.ventas[0]?.at ?? null);
  const { w, h } = useVentana();

  const cargar = useCallback(async () => {
    const sb = createClient();
    const [a, b] = await Promise.all([sb.rpc("metas_ventas_publico"), sb.rpc("metas_pantalla_extra")]);
    if (!a.error && a.data) {
      const nuevas = normalizarAvance(a.data as Record<string, unknown>[]);
      const subieron = nuevas.filter((f) => f.pct > (previo.current.get(f.id) ?? f.pct));
      if (subieron.length) {
        setBrillo(new Set(subieron.map((f) => f.id)));
        window.setTimeout(() => setBrillo(new Set()), 4000);
      }
      previo.current = new Map(nuevas.map((f) => [f.id, f.pct]));
      setFilas(nuevas);
    }
    if (!b.error && b.data) {
      const e = b.data as ExtraPantalla;
      const top = e.ventas[0];
      if (top && ultVenta.current && top.at !== ultVenta.current) {
        setAviso(`¡Nueva venta de ${top.quien}! 🎉`);
        setSlide(0);
        window.setTimeout(() => setAviso(null), 9000);
      }
      ultVenta.current = top?.at ?? ultVenta.current;
      setExtra(e);
    }
  }, []);

  useEffect(() => {
    const sb = createClient();
    let t: number | undefined;
    const pronto = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => void cargar(), 800);
    };
    const canal = sb.channel("pantalla-metas").on("postgres_changes", { event: "*", schema: "public", table: "ventas_pulso" }, pronto).subscribe();
    const respaldo = window.setInterval(() => void cargar(), 60_000);
    const reloj = window.setInterval(() => setAhora(Date.now()), 20_000);
    const recarga = window.setTimeout(() => window.location.reload(), 6 * 3600_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(respaldo);
      window.clearInterval(reloj);
      window.clearTimeout(recarga);
      void sb.removeChannel(canal);
    };
  }, [cargar]);

  const SLIDES = 6;
  useEffect(() => {
    const t = window.setInterval(() => {
      setSlide((s) => {
        const n = (s + 1) % SLIDES;
        if (n === 3) setConsejo((c) => (c + 1) % CONSEJOS.length);
        if (n === 4) setPag((p) => (p + 1) % CATALOGO.length);
        return n;
      });
    }, SEG * 1000);
    return () => window.clearInterval(t);
  }, []);

  const f0 = filas[0];
  const ritmo = f0 ? ritmoDe(f0.dia, f0.dias_mes) : 0;
  const equipo = f0?.equipo_pct ?? 0;
  const esCasa = (f: AvanceMeta) => /casa\s*local/i.test(f.nombre);
  const esEspecial = (f: AvanceMeta) => esCasa(f) || /^vts\b/i.test(f.nombre.trim());
  const especiales = [...filas.filter(esCasa), ...filas.filter((f) => esEspecial(f) && !esCasa(f))];
  const orden = useMemo(() => filas.filter((f) => !esEspecial(f)).sort((a, b) => b.pct - a.pct), [filas]);

  // Tamanos segun la pantalla: todo cabe sin scroll.
  const banda = 180; // mascota y cintilla abajo
  const cont = Math.max(420, h - 76 - banda);
  const izq = w * 0.66 - 48;
  const alto1 = cont * 0.42;
  const tamEq = Math.max(110, Math.min(alto1 - 32, (izq * 0.58) * 0.5, 250));
  const tamEsp = Math.max(90, Math.min(alto1 - 64, (izq * 0.42) / Math.max(1, especiales.length) - 40, 200));
  const filasV = orden.length > 5 ? 2 : 1;
  const colsV = Math.max(1, Math.ceil(orden.length / filasV));
  const tamV = Math.max(80, Math.min((cont * 0.58) / filasV - 64, izq / colsV - 36, 230));

  if (!f0) return <p className="p-10 text-center text-2xl text-slate-500">No hay metas activas este mes.</p>;
  const mes = MESES[Number(f0.mes.slice(5, 7)) - 1];
  const diaDe = (d?: string | null) => (d ? Number(d.slice(8, 10)) : 0);
  const rango = f0.desde && f0.hasta ? `del ${diaDe(f0.desde)} al ${diaDe(f0.hasta)} de ${mes}` : mes;
  const faltan = Math.max(0, f0.dias_mes - f0.dia);
  const hora = new Date(ahora).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", timeZone: "America/Chihuahua" });
  const nueva = extra.ventas[0] && ahora - new Date(extra.ventas[0].at).getTime() < 15 * 60_000;

  const titulos = ["Últimas ventas", "Avance del equipo día a día", "Prospectos cerrados", "Consejo de venta", "De nuestro catálogo", "Hoy en números"];
  const panel = [
    // 0: ultimas ventas
    <ul key="v" className="space-y-2.5">
      {extra.ventas.length ? extra.ventas.slice(0, 6).map((v, i) => (
        <li key={v.at + i} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 ${i === 0 ? "bg-green-50 ring-2 ring-green-300" : "bg-slate-50"}`} style={{ animation: `tv-entra .5s ${i * 0.08}s both` }}>
          <span className="flex min-w-0 items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${i === 0 ? "bg-green-600 text-white" : "bg-white text-slate-600"}`}>🧾</span>
            <span className="truncate text-xl font-bold text-slate-900">{v.quien}</span>
          </span>
          <span className={`shrink-0 text-base ${i === 0 && nueva ? "font-bold text-green-700" : "text-slate-500"}`}>{haceTxt(v.at, ahora)}</span>
        </li>
      )) : <p className="text-center text-lg text-slate-500">Todavía no hay ventas en el periodo. ¡Que la primera sea la tuya!</p>}
    </ul>,
    // 1: grafica diaria
    <div key="g" className="flex h-full flex-col">
      <div className="min-h-0 flex-1"><GraficaDiaria diario={extra.diario} dias={f0.dias_mes} /></div>
      <p className="text-center text-sm text-slate-500"><span className="font-bold text-blue-700">Azul:</span> lo que llevamos · <span className="font-bold text-slate-800">Línea punteada:</span> el ritmo para llegar al 100%</p>
    </div>,
    // 2: cierres
    <div key="c" className="space-y-3">
      <div className="rounded-xl bg-violet-50 px-4 py-3 text-center"><p className="text-5xl font-extrabold text-violet-700">{extra.hoy.cierres}</p><p className="text-sm font-medium text-violet-800">prospectos cerrados hoy</p></div>
      <ul className="space-y-2">
        {extra.cierres.length ? extra.cierres.slice(0, 5).map((c, i) => (
          <li key={c.at + i} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-2.5" style={{ animation: `tv-entra .5s ${i * 0.08}s both` }}>
            <span className="truncate text-lg font-bold text-slate-900">🤝 {c.quien}</span>
            <span className="shrink-0 text-sm text-slate-500">{haceTxt(c.at, ahora)}</span>
          </li>
        )) : <p className="text-center text-slate-500">Aún no hay prospectos cerrados este periodo.</p>}
      </ul>
    </div>,
    // 3: consejo
    <div key="t" className="flex h-full flex-col items-center justify-center gap-5 text-center">
      <span className="text-7xl">💡</span>
      <p className="text-3xl font-bold leading-snug text-slate-900" style={{ animation: "tv-entra .6s both" }}>{CONSEJOS[consejo]}</p>
    </div>,
    // 4: catalogo
    <div key="k" className="flex h-full items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/pantalla/catalogo/${CATALOGO[pag]}.jpg`} alt="Página del catálogo ESC" className="max-h-full max-w-full rounded-xl object-contain shadow-lg" style={{ animation: "tv-zoom 12s ease-out both" }} />
    </div>,
    // 5: hoy
    <div key="h" className="grid h-full grid-cols-2 content-center gap-3">
      {[
        { n: extra.hoy.ventas, t: "ventas hoy", c: "bg-green-50 text-green-700" },
        { n: extra.hoy.prospectos, t: "prospectos nuevos hoy", c: "bg-sky-50 text-sky-700" },
        { n: extra.hoy.cierres, t: "prospectos cerrados hoy", c: "bg-violet-50 text-violet-700" },
        { n: faltan, t: faltan === 1 ? "día para cerrar" : "días para cerrar", c: "bg-amber-50 text-amber-700" },
      ].map((x) => (
        <div key={x.t} className={`rounded-2xl px-3 py-5 text-center ${x.c}`}>
          <p className="text-6xl font-extrabold tabular-nums">{x.n}</p>
          <p className="mt-1 text-base font-semibold">{x.t}</p>
        </div>
      ))}
    </div>,
  ];

  const ticker = [
    extra.ventas[0] ? `🧾 Última venta: ${extra.ventas[0].quien} (${haceTxt(extra.ventas[0].at, ahora)})` : "",
    orden[0] ? `🏆 ${orden[0].nombre} va en primer lugar con ${pctTxt(orden[0].pct)}` : "",
    `📈 El equipo lleva ${pctTxt(equipo)} · el ritmo es ${pctTxt(ritmo)}`,
    ...especiales.map((f) => `${esCasa(f) ? "🏠" : "🌵"} ${f.nombre} va en ${pctTxt(f.pct)}`),
    ...orden.filter((f) => f.pct >= 100).map((f) => `🎉 ¡${f.nombre} ya llegó a su meta!`),
    ...FRASES,
  ].filter(Boolean);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#eef3fb]">
      <style>{`
        @keyframes tv-entra { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        @keyframes tv-zoom { from { transform: scale(.96); opacity: 0; } 15% { opacity: 1; } to { transform: scale(1.02); } }
        @keyframes tv-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes tv-barra { from { width: 0; } to { width: 100%; } }
        @keyframes tv-aviso { 0% { transform: translateY(-120%); } 10%, 88% { transform: none; } 100% { transform: translateY(-120%); } }
      `}</style>

      {/* Encabezado */}
      <header className="relative flex h-[76px] shrink-0 items-center justify-between gap-4 px-8">
        <div className="flex items-center gap-5">
          <Logo className="h-9" />
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Metas de venta · <span className="capitalize">{mes}</span></h1>
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-600" /></span>
              En vivo · periodo {rango} · día {f0.dia} de {f0.dias_mes}
            </p>
          </div>
        </div>
        <p className="text-4xl font-extrabold tabular-nums text-slate-800">{hora}</p>
        {aviso && (
          <div className="absolute inset-x-0 top-2 z-50 mx-auto w-fit rounded-full bg-green-600 px-8 py-3 text-2xl font-extrabold text-white shadow-2xl" style={{ animation: "tv-aviso 9s ease-in-out both" }}>{aviso}</div>
        )}
      </header>

      {/* Contenido */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 px-8">
        <div className="flex min-h-0 flex-col gap-4">
          {/* Equipo y especiales */}
          <div className="grid min-h-0 gap-4" style={{ height: "42%", gridTemplateColumns: especiales.length ? `minmax(0,1.3fr) repeat(${especiales.length}, minmax(0,1fr))` : "1fr" }}>
            <div className="flex min-h-0 items-center gap-5 overflow-hidden rounded-3xl bg-white px-5 shadow-sm">
              <Anillo pct={equipo} ritmo={ritmo} tam={tamEq} grosor={Math.round(tamEq / 11)}>
                <span className="font-extrabold tabular-nums text-slate-900" style={{ fontSize: tamEq / 5.2 }}>{pctTxt(equipo)}</span>
                <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">Equipo</span>
              </Anillo>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-slate-600" style={{ fontSize: Math.max(13, tamEq / 15) }}>Ritmo de hoy</p>
                <p className="font-extrabold leading-none text-slate-900" style={{ fontSize: tamEq / 4.6 }}>{pctTxt(ritmo)}</p>
                <div className="relative h-4 overflow-hidden rounded-full bg-slate-200">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-slate-400" style={{ width: `${Math.min(ritmo, 100)}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(equipo, 100)}%`, background: COLORES[colorAvance(equipo, ritmo)].trazo, transition: "width 1.2s" }} />
                </div>
                <p className="text-slate-500" style={{ fontSize: Math.max(12, tamEq / 17) }}>{equipo >= ritmo ? "¡Vamos arriba del ritmo! 💪" : `Faltan ${pctTxt(Math.max(0, ritmo - equipo))} para el ritmo`}</p>
              </div>
            </div>
            {especiales.map((f) => {
              const c = COLORES[colorAvance(f.pct, ritmo)];
              return (
                <div key={f.id} className={`flex min-h-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-3xl bg-white px-3 shadow-sm transition-all duration-700 ${brillo.has(f.id) ? "scale-[1.03] ring-4 ring-green-300" : ""}`}>
                  <Anillo pct={f.pct} ritmo={ritmo} tam={tamEsp} grosor={Math.round(tamEsp / 11)}>
                    <span className={`font-extrabold tabular-nums ${c.texto}`} style={{ fontSize: tamEsp / 5 }}>{pctTxt(f.pct)}</span>
                  </Anillo>
                  <p className="text-center text-lg font-bold text-slate-900">{esCasa(f) ? "🏠" : "🌵"} {f.nombre}</p>
                </div>
              );
            })}
          </div>

          {/* Vendedores */}
          <div className="grid min-h-0 flex-1 gap-4" style={{ gridTemplateColumns: `repeat(${colsV}, minmax(0,1fr))`, gridTemplateRows: `repeat(${filasV}, minmax(0,1fr))` }}>
            {orden.map((f, i) => {
              const c = COLORES[colorAvance(f.pct, ritmo)];
              return (
                <div key={f.id} className={`relative flex min-h-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-3xl bg-white px-2 shadow-sm transition-all duration-700 ${brillo.has(f.id) ? "scale-[1.04] ring-4 ring-green-300" : ""}`}>
                  <span className={`absolute left-3 top-2 text-lg font-extrabold ${i === 0 ? "text-amber-500" : "text-slate-400"}`}>{i === 0 ? "🏆" : `#${i + 1}`}</span>
                  <Anillo pct={f.pct} ritmo={ritmo} tam={tamV} grosor={Math.round(tamV / 11)}>
                    <span className={`font-extrabold tabular-nums ${c.texto}`} style={{ fontSize: tamV / 5 }}>{pctTxt(f.pct)}</span>
                    {f.pct >= 100 && <span className="text-xs font-bold text-green-700">¡Meta!</span>}
                  </Anillo>
                  <p className="max-w-full truncate px-2 text-center text-lg font-bold text-slate-900">{f.nombre}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel que va cambiando */}
        <aside className="flex min-h-0 flex-col rounded-3xl bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-2xl font-extrabold text-slate-900">{titulos[slide]}</h2>
            <div className="flex gap-1.5">{titulos.map((_, k) => <span key={k} className={`h-2.5 rounded-full transition-all ${k === slide ? "w-6 bg-brand-600" : "w-2.5 bg-slate-300"}`} />)}</div>
          </div>
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-slate-100"><div key={slide} className="h-1 bg-brand-500" style={{ animation: `tv-barra ${SEG}s linear both` }} /></div>
          <div key={`${slide}-${pag}-${consejo}`} className="min-h-0 flex-1 overflow-hidden" style={{ animation: "tv-entra .6s both" }}>{panel[slide]}</div>
        </aside>
      </div>

      {/* Banda de abajo: la mascota camina y la cintilla corre */}
      <div className="relative shrink-0" style={{ height: banda }}>
        <div className="absolute inset-x-0 bottom-0 flex h-11 items-center overflow-hidden bg-brand-700 text-lg font-semibold text-white">
          <div className="flex w-max whitespace-nowrap" style={{ animation: `tv-ticker ${Math.max(40, ticker.length * 7)}s linear infinite` }}>
            {[...ticker, ...ticker].map((t, k) => <span key={k} className="px-10">{t}</span>)}
          </div>
        </div>
      </div>
      <MascotaMetas abajo={46} alLado mensajes={ticker.slice(0, 8)} />
    </div>
  );
}
