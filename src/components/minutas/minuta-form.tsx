"use client";

import { useMemo, useState } from "react";
import { enviarMinutaAction, saveMinutaAction } from "@/actions/minutas";
import { areaCls, useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { ROL_LABEL } from "@/lib/ops/roles";
import type { Rol } from "@/lib/auth/route-guard";
import { PUNTO_VACIO, type MinutaExterno, type MinutaPunto, type MinutaRow } from "@/lib/minutas";

export type MinutaUsuario = { id: string; nombre: string; rol: string };

const PASOS = ["Reunión", "Puntos", "Firmas", "Revisar"] as const;

/** Minuta por pasos: datos de la reunion, puntos tratados, quien firma y revision final. */
export function MinutaForm({ minuta, firmantes: iniFirmantes, usuarios, yo, today }: { minuta: MinutaRow | null; firmantes: string[]; usuarios: MinutaUsuario[]; yo: string; today: string }) {
  const [paso, setPaso] = useState(0);
  const [v, setV] = useState({
    tema: minuta?.tema ?? "",
    responsable: minuta?.responsable ?? "",
    lugar: minuta?.lugar ?? "",
    fecha: minuta?.fecha ?? today,
    hora_inicio: minuta?.hora_inicio?.slice(0, 5) ?? "",
    hora_fin: minuta?.hora_fin?.slice(0, 5) ?? "",
    proxima_tema: minuta?.proxima_tema ?? "",
    proxima_fecha: minuta?.proxima_fecha ?? "",
    proxima_hora: minuta?.proxima_hora?.slice(0, 5) ?? "",
    proxima_lugar: minuta?.proxima_lugar ?? "",
  });
  const [puntos, setPuntos] = useState<MinutaPunto[]>(minuta?.desarrollo?.length ? minuta.desarrollo : [{ ...PUNTO_VACIO }]);
  const [externos, setExternos] = useState<MinutaExterno[]>(minuta?.externos ?? []);
  const [firmantes, setFirmantes] = useState<string[]>(iniFirmantes.length ? iniFirmantes : [yo]);
  const [buscar, setBuscar] = useState("");
  const { run, busy, notice, setNotice, router } = useRun();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const setPunto = (i: number, k: keyof MinutaPunto, val: string) => setPuntos((l) => l.map((p, j) => (j === i ? { ...p, [k]: val } : p)));
  const userOpts = useMemo(() => usuarios.filter((u) => !buscar || u.nombre.toLowerCase().includes(buscar.toLowerCase())), [usuarios, buscar]);
  const nombre = (id: string) => usuarios.find((u) => u.id === id)?.nombre ?? "";

  const faltaPaso = (p: number): string | null => {
    if (p === 0 && v.tema.trim().length < 3) return "Escribe el tema de la reunión";
    if (p === 1 && !puntos.some((x) => x.tema.trim().length >= 2)) return "Agrega al menos un punto con su tema";
    if (p === 2 && !firmantes.length) return "Elige quién debe firmar";
    return null;
  };
  const next = () => {
    const f = faltaPaso(paso);
    if (f) return setNotice({ tone: "error", text: f });
    setNotice(null);
    setPaso((p) => Math.min(p + 1, PASOS.length - 1));
  };
  const payload = () => ({ ...v, desarrollo: puntos.filter((p) => p.tema.trim()), externos: externos.filter((x) => x.nombre.trim()) });

  function guardar(enviar: boolean) {
    run(enviar ? "send" : "save", async () => {
      const r = await saveMinutaAction(minuta?.id ?? null, payload(), firmantes);
      if (!r.ok || !enviar) return r;
      const s = await enviarMinutaAction(r.id);
      return s.ok ? r : s;
    }, (r) => {
      if (r.ok) router.push(`/minutas/${r.id}${enviar ? "?enviada=1" : ""}`);
    });
  }

  return (
    <div className="space-y-4">
      <ol className="grid grid-cols-4 gap-1 text-xs font-medium">
        {PASOS.map((p, i) => (
          <li key={p}>
            <button type="button" onClick={() => (i <= paso || !faltaPaso(paso) ? setPaso(i) : next())} className={`w-full rounded-md border px-2 py-2 text-center ${i === paso ? "border-brand-600 bg-brand-50 text-brand-800" : i < paso ? "border-green-200 bg-green-50 text-green-800" : "border-slate-200 bg-white text-slate-500"}`}>
              <span className="block text-[10px] text-slate-400">Paso {i + 1}</span>
              {p}
            </button>
          </li>
        ))}
      </ol>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {paso === 0 && (
        <Card className="space-y-3 p-4 sm:p-5">
          <Field label="Tema de la reunión *"><Input value={v.tema} onChange={set("tema")} placeholder="Ej. Revisión de cobranza de noviembre" autoFocus /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Responsable de la reunión"><Input value={v.responsable} onChange={set("responsable")} placeholder="Quién la dirige" /></Field>
            <Field label="Lugar o enlace virtual"><Input value={v.lugar} onChange={set("lugar")} placeholder="Sala de juntas, Meet, Zoom..." /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Fecha *"><Input type="date" value={v.fecha} onChange={set("fecha")} /></Field>
            <Field label="Hora de inicio"><Input type="time" value={v.hora_inicio} onChange={set("hora_inicio")} /></Field>
            <Field label="Hora de término"><Input type="time" value={v.hora_fin} onChange={set("hora_fin")} /></Field>
          </div>
        </Card>
      )}

      {paso === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Un punto por cada tema que se trató: qué se habló, qué hay que hacer y a quién le aplica.</p>
          {puntos.map((p, i) => (
            <Card key={i} className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">Punto {i + 1}</p>
                {puntos.length > 1 && <button type="button" onClick={() => setPuntos((l) => l.filter((_, j) => j !== i))} className="text-xs text-red-700 underline">Quitar</button>}
              </div>
              <Field label="Tema *"><Input value={p.tema} onChange={(e) => setPunto(i, "tema", e.target.value)} placeholder="Ej. Clientes con cartera vencida" /></Field>
              <Field label="Explicación (lo que se habló)">
                <textarea value={p.explicacion} onChange={(e) => setPunto(i, "explicacion", e.target.value)} rows={3} className={areaCls} />
              </Field>
              <Field label="Lo que hay que hacer">
                <textarea value={p.actividad} onChange={(e) => setPunto(i, "actividad", e.target.value)} rows={2} className={areaCls} placeholder="Acuerdo o compromiso" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
                <Field label="A quién le aplica">
                  <Input value={p.aplica} onChange={(e) => setPunto(i, "aplica", e.target.value)} list="minuta-usuarios" placeholder="Persona o área responsable" />
                </Field>
                <Field label="Para cuándo"><Input type="date" value={p.fecha} onChange={(e) => setPunto(i, "fecha", e.target.value)} /></Field>
              </div>
            </Card>
          ))}
          <datalist id="minuta-usuarios">{usuarios.map((u) => <option key={u.id} value={u.nombre} />)}</datalist>
          <Button type="button" variant="secondary" onClick={() => setPuntos((l) => [...l, { ...PUNTO_VACIO }])}>+ Agregar otro punto</Button>
        </div>
      )}

      {paso === 2 && (
        <div className="space-y-3">
          <Card className="space-y-3 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">¿Quién debe firmar? *</p>
              <p className="text-xs text-slate-500">Les llega un aviso para revisarla y firmarla en el portal.</p>
            </div>
            <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar persona" />
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
              {userOpts.map((u) => (
                <li key={u.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                    <input type="checkbox" checked={firmantes.includes(u.id)} onChange={(e) => setFirmantes((l) => (e.target.checked ? [...l, u.id] : l.filter((x) => x !== u.id)))} />
                    <span className="flex-1 font-medium text-slate-900">{u.nombre}{u.id === yo && " (tú)"}</span>
                    <span className="text-xs text-slate-500">{ROL_LABEL[u.rol as Rol] ?? u.rol}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-600">{firmantes.length} persona(s) elegida(s)</p>
          </Card>
          <Card className="space-y-3 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">Asistentes que no usan el portal</p>
              <p className="text-xs text-slate-500">Aparecen en la versión para imprimir con su línea de firma.</p>
            </div>
            {externos.map((x, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Input value={x.nombre} onChange={(e) => setExternos((l) => l.map((y, j) => (j === i ? { ...y, nombre: e.target.value } : y)))} placeholder="Nombre" />
                <Input value={x.puesto} onChange={(e) => setExternos((l) => l.map((y, j) => (j === i ? { ...y, puesto: e.target.value } : y)))} placeholder="Puesto" />
                <Input value={x.correo} onChange={(e) => setExternos((l) => l.map((y, j) => (j === i ? { ...y, correo: e.target.value } : y)))} placeholder="Correo" />
                <button type="button" onClick={() => setExternos((l) => l.filter((_, j) => j !== i))} className="px-2 text-sm text-red-700">Quitar</button>
              </div>
            ))}
            <Button type="button" variant="secondary" className="text-xs" onClick={() => setExternos((l) => [...l, { nombre: "", puesto: "", correo: "" }])}>+ Agregar asistente</Button>
          </Card>
        </div>
      )}

      {paso === 3 && (
        <div className="space-y-3">
          <Card className="space-y-3 p-4">
            <p className="text-sm font-semibold text-slate-800">Próxima reunión (opcional)</p>
            <Field label="Tema"><Input value={v.proxima_tema} onChange={set("proxima_tema")} /></Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Fecha"><Input type="date" value={v.proxima_fecha} onChange={set("proxima_fecha")} /></Field>
              <Field label="Hora"><Input type="time" value={v.proxima_hora} onChange={set("proxima_hora")} /></Field>
              <Field label="Lugar o enlace"><Input value={v.proxima_lugar} onChange={set("proxima_lugar")} /></Field>
            </div>
          </Card>
          <Card className="space-y-2 p-4 text-sm">
            <p className="font-semibold text-slate-800">Resumen</p>
            <p><span className="text-slate-500">Reunión:</span> {v.tema || "Sin tema"} · {v.fecha}{v.hora_inicio && ` ${v.hora_inicio}`}{v.lugar && ` · ${v.lugar}`}</p>
            <ol className="list-decimal space-y-1 pl-5">
              {puntos.filter((p) => p.tema.trim()).map((p, i) => (
                <li key={i}><strong>{p.tema}</strong>{p.actividad && `: ${p.actividad}`}{p.aplica && <span className="text-slate-500"> ({p.aplica}{p.fecha && `, ${p.fecha}`})</span>}</li>
              ))}
            </ol>
            <p><span className="text-slate-500">Firman:</span> {firmantes.map(nombre).filter(Boolean).join(", ")}{externos.filter((x) => x.nombre.trim()).length > 0 && ` y ${externos.filter((x) => x.nombre.trim()).length} asistente(s) en papel`}</p>
          </Card>
        </div>
      )}

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        {paso > 0 && <Button type="button" variant="ghost" onClick={() => setPaso((p) => p - 1)}>Atrás</Button>}
        {paso < PASOS.length - 1 ? (
          <Button type="button" onClick={next}>Siguiente</Button>
        ) : (
          <>
            <Button type="button" loading={busy === "send"} disabled={!!busy} onClick={() => guardar(true)}>Enviar a firmas</Button>
          </>
        )}
        <Button type="button" variant="secondary" loading={busy === "save"} disabled={!!busy || v.tema.trim().length < 3 || !puntos.some((p) => p.tema.trim().length >= 2)} onClick={() => guardar(false)} className="ml-auto">
          Guardar borrador
        </Button>
      </div>
    </div>
  );
}
