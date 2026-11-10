"use client";

import { useEffect, useMemo, useState } from "react";
import { crearAnalisisAction, guardarAnalisisAction } from "@/actions/riesgos";
import { useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import {
  actividadVacia, CRITERIOS, etapaModo, INSTRUCCIONES, modoVacio, NIVEL_ROE, nivelRoe, resumenAnalisis, roe, VINCULOS,
  type Actividad, type Calif, type Modo,
} from "@/lib/riesgos";

type CampoCalif = "severidad" | "ocurrencia" | "deteccion" | "severidad_r" | "ocurrencia_r" | "deteccion_r";
const BASE: Record<CampoCalif, keyof typeof CRITERIOS> = {
  severidad: "severidad", ocurrencia: "ocurrencia", deteccion: "deteccion",
  severidad_r: "severidad", ocurrencia_r: "ocurrencia", deteccion_r: "deteccion",
};
const ETAPAS = ["Identificación", "Análisis", "Tratamiento", "Seguimiento"] as const;

const area = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50";

export function RoeBadge({ valor, grande = false }: { valor: number | null; grande?: boolean }) {
  const n = nivelRoe(valor);
  if (!n) return <span className={`inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-slate-500 ${grande ? "text-sm" : "text-xs"}`}>Sin calificar</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold ${NIVEL_ROE[n].cls} ${grande ? "text-base" : "text-xs"}`}>
      {valor} · {NIVEL_ROE[n].label}
    </span>
  );
}

function Modal({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Panel para elegir la calificacion 1 a 5 viendo los criterios del formato. */
function SelectorCalif({ campo, valor, onElegir, onClose }: { campo: CampoCalif; valor: Calif | null; onElegir: (v: Calif | null) => void; onClose: () => void }) {
  const c = CRITERIOS[BASE[campo]];
  const residual = campo.endsWith("_r");
  return (
    <Modal titulo={`${c.titulo}${residual ? " (después de las acciones)" : ""}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">{c.pregunta} Toca la opción que mejor describe el caso.</p>
      <div className="space-y-2">
        {c.niveles.map((n) => (
          <button
            key={n.valor}
            type="button"
            onClick={() => onElegir(n.valor)}
            className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition hover:border-brand-400 hover:bg-brand-50 ${valor === n.valor ? "border-brand-600 bg-brand-50 ring-2 ring-brand-200" : "border-slate-200"}`}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold ${n.valor >= 4 ? "bg-red-100 text-red-700" : n.valor === 3 ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-700"}`}>{n.valor}</span>
            <span className="text-sm text-slate-800">
              {n.texto.length === 1 ? n.texto[0] : (
                <ul className="list-disc space-y-0.5 pl-4">{n.texto.map((t) => <li key={t}>{t}</li>)}</ul>
              )}
            </span>
          </button>
        ))}
      </div>
      {valor && (
        <button type="button" onClick={() => onElegir(null)} className="mt-3 text-xs text-slate-500 underline">Quitar calificación</button>
      )}
    </Modal>
  );
}

function Instrucciones({ onClose }: { onClose: () => void }) {
  return (
    <Modal titulo="Instrucciones de llenado" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="font-semibold text-slate-900">Nivel de riesgo (ROE) = Severidad × Ocurrencia × Detección</p>
          <p className="mt-1 text-slate-600">Cada una se califica del 1 al 5, así que el ROE va de 1 a 125.</p>
          <ul className="mt-2 space-y-1.5">
            {(["bajo", "medio", "alto"] as const).map((k) => (
              <li key={k} className="flex items-center gap-2">
                <span className={`w-20 rounded px-2 py-0.5 text-center text-xs font-semibold ${NIVEL_ROE[k].cls}`}>{NIVEL_ROE[k].label}</span>
                <span className="w-20 font-medium text-slate-800">{NIVEL_ROE[k].rango}</span>
                <span className="text-slate-600">{NIVEL_ROE[k].que}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Una severidad de 4 o 5 se marca en rojo aunque el ROE salga bajo: conviene revisarla.</p>
        </div>
        <div>
          <p className="mb-1 font-semibold text-slate-900">Cómo se llena, por etapas</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-slate-700">
            <li><strong>Identificación:</strong> la actividad, sus modos de falla, los efectos, con qué se vincula y si es riesgo u oportunidad.</li>
            <li><strong>Análisis:</strong> severidad, causas, ocurrencia, controles actuales y detección. El ROE sale solo.</li>
            <li><strong>Tratamiento:</strong> acciones para reducir el riesgo, responsable y fecha compromiso.</li>
            <li><strong>Seguimiento:</strong> qué se hizo, cuándo se verificó y la nueva calificación (riesgo residual).</li>
          </ol>
        </div>
        <div>
          <p className="mb-1 font-semibold text-slate-900">Qué va en cada campo</p>
          <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {INSTRUCCIONES.map((i) => (
              <div key={i.n} className="grid gap-1 px-3 py-2 sm:grid-cols-[13rem_1fr]">
                <dt className="font-medium text-slate-800">{i.campo}</dt>
                <dd className="text-slate-600">{i.texto}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Modal>
  );
}

function BotonCalif({ campo, valor, onAbrir, disabled }: { campo: CampoCalif; valor: Calif | null; onAbrir: () => void; disabled: boolean }) {
  const c = CRITERIOS[BASE[campo]];
  const nivel = valor ? c.niveles[valor - 1] : null;
  const rojo = BASE[campo] === "severidad" && (valor ?? 0) >= 4;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onAbrir}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${valor ? (rojo ? "border-red-300 bg-red-50" : "border-slate-300 bg-white") : "border-dashed border-brand-300 bg-brand-50/50"} ${disabled ? "cursor-default" : "hover:border-brand-500"}`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold ${valor ? (rojo ? "bg-red-600 text-white" : "bg-slate-900 text-white") : "bg-white text-brand-600 ring-1 ring-brand-300"}`}>{valor ?? "?"}</span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{c.titulo}</span>
        <span className="line-clamp-2 block text-sm text-slate-800">{nivel ? nivel.texto[0] : disabled ? "Sin calificar" : "Toca para elegir"}</span>
      </span>
    </button>
  );
}

export function AnalisisEditor({
  id, folio, inicial, puedeEditar, today, autor,
}: {
  id: string | null;
  folio?: string;
  inicial: { proceso: string; fecha: string; actividades: Actividad[] };
  puedeEditar: boolean;
  today: string;
  autor?: string;
}) {
  const [proceso, setProceso] = useState(inicial.proceso);
  const [fecha, setFecha] = useState(inicial.fecha || today);
  const [acts, setActs] = useState<Actividad[]>(() => (inicial.actividades.length ? inicial.actividades : [actividadVacia()]));
  const [sucio, setSucio] = useState(false);
  const [abierto, setAbierto] = useState<Record<string, number>>(() => {
    // Al empezar: abrir el primer modo que tenga algo pendiente, en esa etapa.
    for (const a of acts) for (const m of a.modos) if (etapaModo(m) < 5) return { [m.id]: etapaModo(m) };
    return {};
  });
  const [selector, setSelector] = useState<{ a: string; m: string; campo: CampoCalif } | null>(null);
  const [ayuda, setAyuda] = useState(false);
  const { run, busy, notice, setNotice, router } = useRun();
  const ro = !puedeEditar;
  const res = useMemo(() => resumenAnalisis(acts), [acts]);

  useEffect(() => {
    if (!sucio) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [sucio]);

  const cambia = (f: (a: Actividad[]) => Actividad[]) => {
    setActs((x) => f(x));
    setSucio(true);
  };
  const setAct = (aid: string, patch: Partial<Actividad>) => cambia((x) => x.map((a) => (a.id === aid ? { ...a, ...patch } : a)));
  const setModo = (aid: string, mid: string, patch: Partial<Modo>) =>
    cambia((x) => x.map((a) => (a.id === aid ? { ...a, modos: a.modos.map((m) => (m.id === mid ? { ...m, ...patch } : m)) } : a)));
  const addModo = (aid: string) => {
    const m = modoVacio();
    cambia((x) => x.map((a) => (a.id === aid ? { ...a, modos: [...a.modos, m] } : a)));
    setAbierto((s) => ({ ...s, [m.id]: 1 }));
  };
  const quitarModo = (aid: string, mid: string) => {
    if (!window.confirm("¿Quitar este modo de falla?")) return;
    cambia((x) => x.map((a) => (a.id === aid ? { ...a, modos: a.modos.filter((m) => m.id !== mid) } : a)));
  };
  const addAct = () => {
    const a = actividadVacia();
    cambia((x) => [...x, a]);
    setAbierto((s) => ({ ...s, [a.modos[0].id]: 1 }));
  };
  const quitarAct = (aid: string) => {
    if (!window.confirm("¿Quitar esta actividad con todos sus modos de falla?")) return;
    cambia((x) => x.filter((a) => a.id !== aid));
  };

  const guardar = () =>
    run("g", async () => {
      // Se quitan los renglones vacios antes de guardar.
      const limpio = acts
        .map((a) => ({ ...a, modos: a.modos.filter((m) => m.modo.trim() || m.efectos.trim() || m.severidad) }))
        .filter((a) => a.actividad.trim() || a.modos.length);
      const datos = { proceso, fecha, actividades: limpio };
      if (id) return guardarAnalisisAction(id, datos);
      return crearAnalisisAction(datos);
    }, (r) => {
      if (!r.ok) return;
      setSucio(false);
      setNotice({ tone: "success", text: "Análisis guardado." });
      if (!id && r.id) router.replace(`/calidad/riesgos/${r.id}`);
      else router.refresh();
    });

  const modoSel = selector ? acts.find((a) => a.id === selector.a)?.modos.find((m) => m.id === selector.m) : null;

  return (
    <div className="space-y-4 pb-24">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{folio ?? "Análisis nuevo"}{autor ? ` · ${autor}` : ""}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="text-xs" onClick={() => setAyuda(true)}>Instrucciones de llenado</Button>
            {id && <a href={`/api/riesgos/${id}/excel`} className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Descargar Excel</a>}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Field label="Nombre del proceso *"><Input value={proceso} disabled={ro} onChange={(e) => { setProceso(e.target.value); setSucio(true); }} placeholder="Ej. Ventas, Compras, Almacén, Administración" /></Field>
          <Field label="Fecha del análisis"><Input type="date" value={fecha} disabled={ro} max={today} onChange={(e) => { setFecha(e.target.value); setSucio(true); }} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">{res.modos} modo(s) de falla:</span>
          <span className={`rounded px-2 py-0.5 font-semibold ${NIVEL_ROE.alto.cls}`}>{res.alto} alto</span>
          <span className={`rounded px-2 py-0.5 font-semibold ${NIVEL_ROE.medio.cls}`}>{res.medio} medio</span>
          <span className={`rounded px-2 py-0.5 font-semibold ${NIVEL_ROE.bajo.cls}`}>{res.bajo} bajo</span>
          {res.sinCalificar > 0 && <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{res.sinCalificar} sin calificar</span>}
          {res.sinAcciones > 0 && <span className="rounded bg-orange-100 px-2 py-0.5 font-medium text-orange-800">{res.sinAcciones} medio/alto sin acciones</span>}
        </div>
      </Card>

      {acts.map((a, ai) => (
        <Card key={a.id} className="space-y-3 border-l-4 border-l-yellow-400 p-4 sm:p-5">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label={`Artículo / Actividad ${ai + 1}`}>
                <Input value={a.actividad} disabled={ro} onChange={(e) => setAct(a.id, { actividad: e.target.value })} placeholder="Ej. Recepción de pedidos del cliente" className="font-medium" />
              </Field>
            </div>
            {!ro && acts.length > 1 && <Button variant="ghost" className="text-xs text-red-700" onClick={() => quitarAct(a.id)}>Quitar actividad</Button>}
          </div>

          <div className="space-y-2">
            {a.modos.map((m, mi) => {
              const etapa = abierto[m.id];
              const r = roe(m.severidad, m.ocurrencia, m.deteccion);
              const rr = roe(m.severidad_r, m.ocurrencia_r, m.deteccion_r);
              const pend = etapaModo(m);
              const set = (k: keyof Modo) => (e: { target: { value: string } }) => setModo(a.id, m.id, { [k]: e.target.value } as Partial<Modo>);
              return (
                <div key={m.id} className="rounded-lg border border-slate-200 bg-white">
                  <button type="button" onClick={() => setAbierto((s) => ({ ...s, [m.id]: s[m.id] ? 0 : Math.min(pend, 4) }))} className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50">
                    <span className="text-xs font-semibold text-slate-400">{mi + 1}.</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{m.modo || <span className="font-normal italic text-slate-400">Modo de falla sin escribir</span>}</span>
                    {m.tipo === "oportunidad" && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800">Oportunidad</span>}
                    <span className="text-xs text-slate-500">S{m.severidad ?? "-"} O{m.ocurrencia ?? "-"} D{m.deteccion ?? "-"}</span>
                    <RoeBadge valor={r} />
                    {rr != null && <span className="text-xs text-slate-500">→ <RoeBadge valor={rr} /></span>}
                    <span className="text-xs text-slate-400">{pend >= 5 ? "Completo" : `Etapa ${pend}/4`} {etapa ? "▲" : "▼"}</span>
                  </button>
                  {!!etapa && (
                    <div className="space-y-3 border-t border-slate-100 p-3 sm:p-4">
                      <div className="flex flex-wrap gap-1">
                        {ETAPAS.map((t, i) => (
                          <button key={t} type="button" onClick={() => setAbierto((s) => ({ ...s, [m.id]: i + 1 }))}
                            className={`rounded-full px-3 py-1 text-xs font-medium ${etapa === i + 1 ? "bg-slate-900 text-white" : i + 1 < pend ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                            {i + 1 < pend ? "✓ " : `${i + 1}. `}{t}
                          </button>
                        ))}
                      </div>

                      {etapa === 1 && (
                        <div className="space-y-3">
                          <Field label="Modo potencial de falla *"><textarea rows={2} className={area} value={m.modo} disabled={ro} onChange={set("modo")} placeholder="¿Qué puede salir mal en esta actividad?" /></Field>
                          <Field label="Efectos potenciales de la falla *"><textarea rows={3} className={area} value={m.efectos} disabled={ro} onChange={set("efectos")} placeholder={"Si pasa, ¿qué afecta? Puedes poner varios, uno por renglón:\n- Queja del cliente\n- Retraso en la entrega"} /></Field>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Vinculado con">
                              <Input list="riesgo-vinculos" value={m.vinculado} disabled={ro} onChange={set("vinculado")} placeholder="Ej. Cliente, requisito legal..." />
                            </Field>
                            <Field label="Clasificación">
                              <div className="flex gap-2">
                                {(["riesgo", "oportunidad"] as const).map((t) => (
                                  <button key={t} type="button" disabled={ro} onClick={() => setModo(a.id, m.id, { tipo: t })}
                                    className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${m.tipo === t ? (t === "riesgo" ? "border-amber-500 bg-amber-50 text-amber-900" : "border-sky-500 bg-sky-50 text-sky-900") : "border-slate-300 bg-white text-slate-600"}`}>
                                    {t === "riesgo" ? "Riesgo" : "Oportunidad"}
                                  </button>
                                ))}
                              </div>
                            </Field>
                          </div>
                        </div>
                      )}

                      {etapa === 2 && (
                        <div className="space-y-3">
                          <BotonCalif campo="severidad" valor={m.severidad} disabled={ro} onAbrir={() => setSelector({ a: a.id, m: m.id, campo: "severidad" })} />
                          <Field label="Causas potenciales / mecanismos de falla"><textarea rows={2} className={area} value={m.causas} disabled={ro} onChange={set("causas")} placeholder="¿Qué puede provocar que pase?" /></Field>
                          <BotonCalif campo="ocurrencia" valor={m.ocurrencia} disabled={ro} onAbrir={() => setSelector({ a: a.id, m: m.id, campo: "ocurrencia" })} />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Controles actuales de prevención"><textarea rows={2} className={area} value={m.prevencion} disabled={ro} onChange={set("prevencion")} placeholder="¿Qué se hace hoy para que no pase?" /></Field>
                            <Field label="Controles actuales de detección"><textarea rows={2} className={area} value={m.deteccion_ctrl} disabled={ro} onChange={set("deteccion_ctrl")} placeholder="¿Cómo nos damos cuenta si pasa?" /></Field>
                          </div>
                          <BotonCalif campo="deteccion" valor={m.deteccion} disabled={ro} onAbrir={() => setSelector({ a: a.id, m: m.id, campo: "deteccion" })} />
                          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                            <span className="font-medium text-slate-700">Nivel de riesgo (ROE):</span>
                            <span className="text-slate-500">{m.severidad ?? "?"} × {m.ocurrencia ?? "?"} × {m.deteccion ?? "?"} =</span>
                            <RoeBadge valor={r} grande />
                            {nivelRoe(r) && <span className="text-xs text-slate-600">{NIVEL_ROE[nivelRoe(r)!].que}</span>}
                          </div>
                        </div>
                      )}

                      {etapa === 3 && (
                        <div className="space-y-3">
                          {nivelRoe(r) && nivelRoe(r) !== "bajo" && !m.acciones.trim() && <Alert tone="error">Este riesgo es {NIVEL_ROE[nivelRoe(r)!].label.toLowerCase()}: define acciones, responsable y fecha.</Alert>}
                          <Field label="Acciones recomendadas a realizar"><textarea rows={3} className={area} value={m.acciones} disabled={ro} onChange={set("acciones")} placeholder="¿Qué se va a hacer para reducir o eliminar el riesgo?" /></Field>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Responsable"><Input value={m.responsable} disabled={ro} onChange={set("responsable")} placeholder="Nombre o puesto" /></Field>
                            <Field label="Fecha de terminación (compromiso)"><Input type="date" value={m.fecha_terminacion} disabled={ro} onChange={set("fecha_terminacion")} /></Field>
                          </div>
                        </div>
                      )}

                      {etapa === 4 && (
                        <div className="space-y-3">
                          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                            <Field label="Acciones tomadas"><textarea rows={2} className={area} value={m.acciones_tomadas} disabled={ro} onChange={set("acciones_tomadas")} placeholder="¿Qué se hizo y cómo se verificó?" /></Field>
                            <Field label="Fecha de verificación"><Input type="date" value={m.fecha_verificacion} disabled={ro} onChange={set("fecha_verificacion")} /></Field>
                          </div>
                          <p className="text-xs text-slate-500">Califica otra vez después de las acciones (riesgo residual):</p>
                          <div className="grid gap-2 sm:grid-cols-3">
                            {(["severidad_r", "ocurrencia_r", "deteccion_r"] as const).map((c) => (
                              <BotonCalif key={c} campo={c} valor={m[c]} disabled={ro} onAbrir={() => setSelector({ a: a.id, m: m.id, campo: c })} />
                            ))}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                            <span className="font-medium text-slate-700">Nivel de riesgo residual:</span>
                            <RoeBadge valor={rr} grande />
                            {r != null && rr != null && <span className="text-xs text-slate-600">{rr < r ? `Bajó ${r - rr} puntos: las acciones funcionaron.` : rr === r ? "Quedó igual." : "Subió: revisa las acciones."}</span>}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <div className="flex gap-2">
                          {etapa > 1 && <Button variant="ghost" className="text-xs" onClick={() => setAbierto((s) => ({ ...s, [m.id]: etapa - 1 }))}>← Anterior</Button>}
                          {etapa < 4 && <Button variant="secondary" className="text-xs" onClick={() => setAbierto((s) => ({ ...s, [m.id]: etapa + 1 }))}>Siguiente: {ETAPAS[etapa]} →</Button>}
                        </div>
                        {!ro && a.modos.length > 1 && <Button variant="ghost" className="text-xs text-red-700" onClick={() => quitarModo(a.id, m.id)}>Quitar modo de falla</Button>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!ro && <Button variant="secondary" className="text-xs" onClick={() => addModo(a.id)}>+ Otro modo de falla para esta actividad</Button>}
        </Card>
      ))}

      {!ro && <Button variant="secondary" onClick={addAct}>+ Agregar actividad</Button>}

      <datalist id="riesgo-vinculos">{VINCULOS.map((v) => <option key={v} value={v} />)}</datalist>

      {!ro && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] backdrop-blur md:bottom-0">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 pr-16">
            <span className={`text-sm ${sucio ? "font-medium text-amber-700" : "text-slate-500"}`}>{sucio ? "Tienes cambios sin guardar" : "Todo guardado"}</span>
            <Button loading={busy === "g"} disabled={!sucio && !!id} onClick={guardar}>{id ? "Guardar cambios" : "Guardar análisis"}</Button>
          </div>
        </div>
      )}

      {selector && modoSel && (
        <SelectorCalif
          campo={selector.campo}
          valor={modoSel[selector.campo]}
          onClose={() => setSelector(null)}
          onElegir={(v) => { setModo(selector.a, selector.m, { [selector.campo]: v } as Partial<Modo>); setSelector(null); }}
        />
      )}
      {ayuda && <Instrucciones onClose={() => setAyuda(false)} />}
    </div>
  );
}
