"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { guardarExternoRhAction, agregarFestivoRhAction, borrarTemporadaRhAction, guardarEmpleadoRhAction, guardarReglasRhAction, guardarTemporadaRhAction, quitarFestivoRhAction } from "@/actions/rrhh";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import { DIAS_SEMANA, diasEntre, diasLey, fechaRh, isoDow, JEFE_LABEL, type JefeRol, type Saldo } from "@/lib/rrhh";

const inp = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";
const lbl = "mb-1 block text-xs font-medium text-slate-600";

function aniosA(ingreso: string, hoy: string): number {
  if (!ingreso) return 0;
  const [a, b] = [ingreso, hoy].map((x) => x.split("-").map(Number));
  let n = b[0] - a[0];
  if (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2])) n--;
  return Math.max(n, 0);
}

/** La gerente captura el arranque de un colaborador: ingreso, puesto, jefe y dias que le quedan hoy. */
export function EmpleadoRh({ s, hoy }: { s: Saldo; hoy: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [pend, start] = useTransition();
  const [ingreso, setIngreso] = useState(s.fecha_ingreso ?? "");
  const [puesto, setPuesto] = useState(s.puesto ?? "");
  const [depto, setDepto] = useState(s.departamento ?? "");
  const [nombre, setNombre] = useState(s.nombre);
  const [saldo, setSaldo] = useState(s.saldo_inicial !== null ? String(s.saldo_inicial) : "");
  const [al, setAl] = useState(s.saldo_al ?? hoy);
  const n = aniosA(ingreso, hoy);

  const guardar = () => {
    if (!ingreso) return toast("Pon la fecha de ingreso.", "error");
    if (saldo.trim() === "" || Number.isNaN(Number(saldo))) return toast("Pon los días que le quedan.", "error");
    start(async () => {
      const r = await guardarEmpleadoRhAction({ colaborador_id: s.colaborador_id, profile_id: s.empleado_id, nombre: s.sin_portal ? nombre : null, fecha_ingreso: ingreso, puesto: puesto || null, departamento: depto || null, saldo_inicial: Number(saldo), saldo_al: al, notas: null });
      if (!r.ok) return toast(r.error, "error");
      toast(`Listo: ${s.sin_portal ? nombre : s.nombre} quedó capturado.`, "success");
      setAbierto(false);
      router.refresh();
    });
  };

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className={`rounded-md border px-2.5 py-1 text-xs font-medium ${s.capturado ? "border-slate-300 text-slate-700 hover:bg-slate-50" : "border-brand-500 text-brand-700 hover:bg-brand-50"}`}>
        {s.capturado ? "Editar" : "Capturar"}
      </button>
    );
  }
  return (
    <div className="mt-2 w-full space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={lbl}>Fecha de ingreso</span>
          <input type="date" className={inp} value={ingreso} max={hoy} onChange={(e) => setIngreso(e.target.value)} />
        </label>
        <label className="block">
          <span className={lbl}>Puesto (lo ven los demás en el calendario)</span>
          <input className={inp} value={puesto} maxLength={80} onChange={(e) => setPuesto(e.target.value)} placeholder="Ej. Almacenista" />
        </label>
        <label className="block">
          <span className={lbl}>Departamento / área</span>
          <input className={inp} value={depto} maxLength={80} onChange={(e) => setDepto(e.target.value)} />
        </label>
        {s.sin_portal && (
          <label className="block">
            <span className={lbl}>Nombre (sin portal)</span>
            <input className={inp} value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} />
          </label>
        )}
        <label className="block">
          <span className={lbl}>Días de vacaciones que le quedan</span>
          <input type="number" step="0.5" className={inp} value={saldo} onChange={(e) => setSaldo(e.target.value)} placeholder="Ej. 8" />
        </label>
        <label className="block">
          <span className={lbl}>Al día</span>
          <input type="date" className={inp} value={al} max={hoy} onChange={(e) => setAl(e.target.value)} />
        </label>
      </div>
      {ingreso && (
        <p className="rounded bg-white px-2 py-1.5 text-xs text-slate-600">
          Con {n} {n === 1 ? "año cumplido" : "años cumplidos"}, por ley le tocan <b>{diasLey(n)}</b> días en su año actual. En su próximo aniversario gana <b>{diasLey(n + 1)}</b>.
          {" "}El portal suma solo esos días en cada aniversario después del {fechaRh(al)}.
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={guardar} loading={pend}>Guardar</Button>
        <Button variant="ghost" onClick={() => setAbierto(false)}>Cerrar</Button>
      </div>
    </div>
  );
}

/** Reglas de la empresa y tabla de dias por anio (por defecto la de la ley). */
export function ReglasRh({ cfg, tabla }: { cfg: { sabado_laborable: boolean; anticipacion_dias: number; adelanto_max: number }; tabla: { anios: number; dias: number }[] }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [sab, setSab] = useState(cfg.sabado_laborable);
  const [ant, setAnt] = useState(String(cfg.anticipacion_dias));
  const [adl, setAdl] = useState(String(cfg.adelanto_max));
  const [t, setT] = useState(tabla.map((r) => ({ ...r, v: String(r.dias) })));
  const guardar = () =>
    start(async () => {
      const r = await guardarReglasRhAction(
        { sabado_laborable: sab, anticipacion_dias: Math.max(0, Math.round(Number(ant) || 0)), adelanto_max: Math.max(0, Math.round(Number(adl) || 0)) },
        t.map((x) => ({ anios: x.anios, dias: Math.max(0, Math.round(Number(x.v) || 0)) })),
      );
      if (!r.ok) return toast(r.error, "error");
      toast("Reglas guardadas.", "success");
      router.refresh();
    });
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={sab} onChange={(e) => setSab(e.target.checked)} className="h-4 w-4" />
        El sábado es día laboral (si se toma vacaciones el sábado, se descuenta)
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={lbl}>Días de anticipación mínima para pedir vacaciones</span>
          <input type="number" min={0} max={90} className={inp} value={ant} onChange={(e) => setAnt(e.target.value)} />
        </label>
        <label className="block">
          <span className={lbl}>Días que se pueden adelantar (pedir de más del saldo)</span>
          <input type="number" min={0} max={60} className={inp} value={adl} onChange={(e) => setAdl(e.target.value)} />
        </label>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-slate-700">Días de vacaciones por año cumplido (Ley Federal del Trabajo, art. 76)</summary>
        <p className="mt-1 text-xs text-slate-500">Ya viene con lo que marca la ley. Solo cámbialo si la empresa da más días (nunca menos que la ley).</p>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {t.map((x, i) => (
            <label key={x.anios} className="block text-xs">
              <span className="text-slate-500">{x.anios} {x.anios === 1 ? "año" : "años"}</span>
              <input
                type="number"
                min={0}
                className={`${inp} px-2 py-1 ${Number(x.v) < diasLey(x.anios) ? "border-red-400" : ""}`}
                value={x.v}
                onChange={(e) => setT(t.map((y, k) => (k === i ? { ...y, v: e.target.value } : y)))}
              />
            </label>
          ))}
        </div>
      </details>
      <Button onClick={guardar} loading={pend}>Guardar reglas</Button>
    </div>
  );
}

export function FestivosRh({ festivos }: { festivos: { fecha: string; nombre: string }[] }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [f, setF] = useState("");
  const [n, setN] = useState("");
  const agregar = () =>
    start(async () => {
      const r = await agregarFestivoRhAction(f, n);
      if (!r.ok) return toast(r.error, "error");
      setF(""); setN("");
      router.refresh();
    });
  const quitar = (fecha: string) =>
    start(async () => {
      const r = await quitarFestivoRhAction(fecha);
      if (!r.ok) return toast(r.error, "error");
      router.refresh();
    });
  const porAnio = festivos.reduce<Record<string, typeof festivos>>((acc, x) => ((acc[x.fecha.slice(0, 4)] ??= []).push(x), acc), {});
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block">
          <span className={lbl}>Día que se descansa</span>
          <input type="date" className={inp} value={f} onChange={(e) => setF(e.target.value)} />
        </label>
        <label className="block min-w-0 flex-1">
          <span className={lbl}>Nombre</span>
          <input className={inp} value={n} maxLength={120} onChange={(e) => setN(e.target.value)} placeholder="Ej. Día de la Constitución (recorrido)" />
        </label>
        <Button onClick={agregar} loading={pend}>Agregar festivo</Button>
      </div>
      {Object.entries(porAnio).map(([y, l]) => (
        <div key={y} className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <h3 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">{y}</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {l.map((x) => (
              <li key={x.fecha} className="flex items-center justify-between gap-2 px-4 py-2">
                <span><b>{fechaRh(x.fecha)}</b> <span className="text-slate-500">({DIAS_SEMANA[isoDow(x.fecha) - 1]})</span> · {x.nombre}</span>
                <button type="button" disabled={pend} onClick={() => quitar(x.fecha)} className="text-xs text-slate-500 underline hover:text-red-600">Quitar</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

type Temp = { id: string; nombre: string; desde: string; hasta: string; dias_descuento: string[] };

/** Temporada de vacaciones generales: rango y los dias (laborables) que se descuentan a todos. */
export function TemporadaRh({ t, festivos, sabadoLaborable }: { t?: Temp; festivos: string[]; sabadoLaborable: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(t?.nombre ?? "");
  const [desde, setDesde] = useState(t?.desde ?? "");
  const [hasta, setHasta] = useState(t?.hasta ?? "");
  const [sel, setSel] = useState<string[]>(t?.dias_descuento ?? []);
  const dias = useMemo(() => (desde && hasta && hasta >= desde ? diasEntre(desde, hasta).slice(0, 46) : []), [desde, hasta]);
  const laborable = (d: string) => isoDow(d) !== 7 && (sabadoLaborable || isoDow(d) !== 6) && !festivos.includes(d);
  const toggle = (d: string) => setSel(sel.includes(d) ? sel.filter((x) => x !== d) : [...sel, d]);

  const guardar = () =>
    start(async () => {
      const r = await guardarTemporadaRhAction({ id: t?.id ?? null, nombre, desde, hasta, dias_descuento: sel.filter((d) => dias.includes(d)) });
      if (!r.ok) return toast(r.error, "error");
      toast("Temporada guardada: ya se refleja en los días de todos.", "success");
      setAbierto(false);
      if (!t) { setNombre(""); setDesde(""); setHasta(""); setSel([]); }
      router.refresh();
    });
  const borrar = () =>
    start(async () => {
      if (!t) return;
      const r = await borrarTemporadaRhAction(t.id);
      if (!r.ok) return toast(r.error, "error");
      router.refresh();
    });

  if (!abierto) {
    return t ? (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setAbierto(true)} className="text-xs font-medium text-brand-700 underline">Editar</button>
        <button type="button" disabled={pend} onClick={borrar} className="text-xs text-slate-500 underline hover:text-red-600">Borrar</button>
      </div>
    ) : (
      <Button onClick={() => setAbierto(true)}>+ Nueva temporada</Button>
    );
  }
  const nLab = dias.filter(laborable).length;
  return (
    <div className="mt-2 space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={lbl}>Nombre</span>
          <input className={inp} value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Navidad 2026" />
        </label>
        <label className="block">
          <span className={lbl}>Desde</span>
          <input type="date" className={inp} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="block">
          <span className={lbl}>Hasta (incluido)</span>
          <input type="date" className={inp} value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
        </label>
      </div>
      {dias.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-700">Toca los días que <b>se descuentan</b> a todos ({sel.filter((d) => dias.includes(d)).length} de {nLab} laborables). Los demás los da la empresa.</p>
            <div className="flex gap-3 text-xs">
              <button type="button" className="text-brand-700 underline" onClick={() => setSel(dias.filter(laborable))}>Todos</button>
              <button type="button" className="text-slate-500 underline" onClick={() => setSel([])}>Ninguno</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dias.map((d) => {
              const lab = laborable(d);
              const on = sel.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!lab}
                  onClick={() => toggle(d)}
                  title={lab ? "" : festivos.includes(d) ? "Festivo" : "Descanso"}
                  className={`w-16 rounded-md border px-1 py-1 text-center text-xs ${!lab ? "border-slate-200 bg-slate-100 text-slate-400" : on ? "border-violet-600 bg-violet-600 font-semibold text-white" : "border-slate-300 bg-white text-slate-700 hover:border-violet-400"}`}
                >
                  <span className="block text-[10px] opacity-80">{DIAS_SEMANA[isoDow(d) - 1]}</span>
                  {fechaRh(d, false)}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={guardar} loading={pend}>Guardar temporada</Button>
        <Button variant="ghost" onClick={() => setAbierto(false)}>Cerrar</Button>
      </div>
    </div>
  );
}

const AREAS: { rol: JefeRol; area: string }[] = [
  { rol: "supervisor_almacen", area: "Almacén (lo ve el supervisor de almacén)" },
  { rol: "jefe_ventas", area: "Ventas (lo ve la jefa de ventas)" },
  { rol: "supervisor_finanzas", area: "Finanzas (lo ve la supervisora de finanzas)" },
];

/** Alta o cambio de un colaborador sin portal. La gerente elige su area (le aparece a ese jefe) y de una vez sus dias. */
export function ExternoRh({ s, gerente, hoy }: { s?: Saldo; gerente: boolean; hoy?: string }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(s?.nombre ?? "");
  const [puesto, setPuesto] = useState(s?.puesto ?? "");
  const [jr, setJr] = useState<JefeRol>(s?.jefe_rol ?? "supervisor_almacen");
  const [ingreso, setIngreso] = useState("");
  const [saldo, setSaldo] = useState("");
  const conDias = gerente && !s;
  const guardar = (activo?: boolean) =>
    start(async () => {
      if (conDias && ingreso && (saldo.trim() === "" || Number.isNaN(Number(saldo)))) return toast("Pon los días que le quedan (o deja vacía la fecha para capturarlo después).", "error");
      const r = await guardarExternoRhAction({ id: s?.colaborador_id ?? null, nombre, puesto: puesto || null, activo, jefe_rol: gerente ? jr : null });
      if (!r.ok) return toast(r.error, "error");
      if (conDias && ingreso) {
        const d = await guardarEmpleadoRhAction({ colaborador_id: r.id, profile_id: null, nombre, fecha_ingreso: ingreso, puesto: puesto || null, departamento: null, saldo_inicial: Number(saldo), saldo_al: hoy ?? ingreso, notas: null });
        if (!d.ok) return toast(`Se dio de alta, pero los días no se guardaron: ${d.error}`, "error");
      }
      toast(activo === false ? "Colaborador dado de baja." : s ? "Guardado." : `Listo: ${nombre} quedó dado de alta.`, "success");
      setAbierto(false);
      if (!s) { setNombre(""); setPuesto(""); setIngreso(""); setSaldo(""); }
      router.refresh();
    });
  if (!abierto) {
    return s ? (
      <button type="button" onClick={() => setAbierto(true)} className="text-xs font-medium text-slate-600 underline">{gerente ? "Área / baja" : "Nombre / baja"}</button>
    ) : (
      <Button variant="secondary" onClick={() => setAbierto(true)}>+ Colaborador sin portal</Button>
    );
  }
  return (
    <div className="mt-2 w-full space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={lbl}>Nombre completo</span>
          <input className={inp} value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <label className="block">
          <span className={lbl}>Puesto</span>
          <input className={inp} value={puesto} maxLength={80} onChange={(e) => setPuesto(e.target.value)} placeholder="Ej. Cargador" />
        </label>
        {gerente && (
          <label className="block">
            <span className={lbl}>Área</span>
            <select className={inp} value={jr} onChange={(e) => setJr(e.target.value as JefeRol)}>
              {AREAS.map((a) => <option key={a.rol} value={a.rol}>{a.area}</option>)}
            </select>
          </label>
        )}
        {conDias && (
          <>
            <label className="block">
              <span className={lbl}>Fecha de ingreso</span>
              <input type="date" className={inp} value={ingreso} max={hoy} onChange={(e) => setIngreso(e.target.value)} />
            </label>
            <label className="block">
              <span className={lbl}>Días de vacaciones que le quedan hoy</span>
              <input type="number" step="0.5" className={inp} value={saldo} onChange={(e) => setSaldo(e.target.value)} placeholder="Ej. 8" />
            </label>
          </>
        )}
      </div>
      {conDias && ingreso && (
        <p className="rounded bg-white px-2 py-1.5 text-xs text-slate-600">
          Por ley le tocan <b>{diasLey(aniosA(ingreso, hoy ?? ingreso))}</b> días en su año actual; en su próximo aniversario gana <b>{diasLey(aniosA(ingreso, hoy ?? ingreso) + 1)}</b>.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => guardar()} loading={pend}>{s ? "Guardar" : "Dar de alta"}</Button>
        {s && <Button variant="secondary" className="border-red-300 text-red-700" loading={pend} onClick={() => guardar(false)}>Dar de baja</Button>}
        <Button variant="ghost" onClick={() => setAbierto(false)}>Cerrar</Button>
      </div>
    </div>
  );
}
