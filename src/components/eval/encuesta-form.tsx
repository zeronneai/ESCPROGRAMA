"use client";

import { useState, useTransition } from "react";
import { responderEncuestaAction } from "@/actions/evaluaciones";
import { ESCALA_CLIENTE } from "@/lib/evaluaciones";

const inp = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none";

export function EncuestaForm({ token, preguntas, contacto }: { token: string; preguntas: { id: string; texto: string }[]; contacto: string | null }) {
  const [v, setV] = useState<Record<string, number>>({});
  const [comentario, setComentario] = useState("");
  const [nombre, setNombre] = useState(contacto ?? "");
  const [puesto, setPuesto] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const faltan = preguntas.filter((p) => !v[p.id]).length;
  const listo = faltan === 0 && puesto.trim().length > 1;

  if (done) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <p className="text-lg font-semibold text-green-900">¡Gracias por su evaluación!</p>
        <p className="mt-1 text-sm text-green-800">Sus respuestas nos ayudan a darle un mejor servicio.</p>
      </div>
    );
  }
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const r = await responderEncuestaAction(token, v, comentario, nombre, puesto);
          if (r.ok) setDone(true);
          else setErr(r.error);
        });
      }}
    >
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="block text-sm font-medium text-slate-700">Nombre de quien contesta</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={150} className={inp} />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium text-slate-700">Puesto *</span>
          <input value={puesto} onChange={(e) => setPuesto(e.target.value)} maxLength={120} className={inp} placeholder="Ej. Jefe de compras" />
        </label>
      </div>
      <p className="text-sm text-slate-600">Marque la opción que mejor describa su experiencia:</p>
      <ol className="space-y-4">
        {preguntas.map((p, i) => (
          <li key={p.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <p className="font-medium text-slate-900">{i + 1}. {p.texto}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ESCALA_CLIENTE.map((e) => (
                <button
                  key={e.v}
                  type="button"
                  aria-pressed={v[p.id] === e.v}
                  onClick={() => setV((x) => ({ ...x, [p.id]: e.v }))}
                  className={`rounded-lg border-2 px-2 py-2.5 text-sm font-medium transition ${v[p.id] === e.v ? e.cls : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <label className="block space-y-1 rounded-xl border border-slate-200 bg-white p-4">
        <span className="block text-sm font-medium text-slate-700">Recomendaciones (opcional)</span>
        <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={3} maxLength={1000} className={inp} placeholder="¿Qué podemos mejorar?" />
      </label>
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
      <button type="submit" disabled={!listo || pending} className="w-full rounded-lg bg-brand-600 px-4 py-3 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
        {pending ? "Enviando..." : faltan > 0 ? `Responda las ${faltan} pregunta(s) restantes` : !puesto.trim() ? "Escriba su puesto" : "Enviar evaluación"}
      </button>
    </form>
  );
}
