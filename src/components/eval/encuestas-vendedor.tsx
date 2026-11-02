"use client";

import { useState } from "react";
import { generarEncuestaAction, marcarEncuestaEnviadaAction } from "@/actions/evaluaciones";
import { Chip, useRun } from "@/components/ops-ui";
import { Alert, EmptyState } from "@/components/ui";
import { encuestaUrl } from "@/lib/evaluaciones";

export interface ClienteEncuesta {
  customer_id: string;
  nombre: string;
  contacto: string | null;
  telefono: string | null;
  correo: string | null;
  encuesta: { id: string; token: string; enviada_at: string | null; medio: string | null; respondida_at: string | null; puntaje: number | null } | null;
}

const fecha = (d: string) => new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

export function EncuestasVendedor({ rows, origin, activa, vendedor }: { rows: ClienteEncuesta[]; origin: string; activa: boolean; vendedor: string }) {
  const [list, setList] = useState(rows);
  const [ver, setVer] = useState<"todos" | "sin" | "enviadas" | "respondidas">("todos");
  const { run, busy, notice, setNotice } = useRun();
  const setEnc = (cid: string, patch: Partial<NonNullable<ClienteEncuesta["encuesta"]>>) =>
    setList((l) => l.map((r) => (r.customer_id === cid ? { ...r, encuesta: { ...(r.encuesta ?? { id: "", token: "", enviada_at: null, medio: null, respondida_at: null, puntaje: null }), ...patch } } : r)));
  const shown = list.filter((r) =>
    ver === "sin" ? !r.encuesta?.enviada_at : ver === "enviadas" ? !!r.encuesta?.enviada_at && !r.encuesta.respondida_at : ver === "respondidas" ? !!r.encuesta?.respondida_at : true,
  );
  const msg = (r: ClienteEncuesta, url: string) =>
    `Hola${r.contacto ? ` ${r.contacto.split(" ")[0]}` : ""}, en ESC queremos mejorar. ¿Nos ayuda a calificar nuestro servicio? Son 5 preguntas, menos de un minuto: ${url} Gracias. ${vendedor}`;
  async function enviar(r: ClienteEncuesta, medio: "whatsapp" | "correo" | "otro") {
    const e = r.encuesta!;
    const url = encuestaUrl(origin, e.token);
    if (medio === "whatsapp") {
      const tel = (r.telefono ?? "").replace(/\D/g, "");
      window.open(`https://wa.me/${tel.length === 10 ? `52${tel}` : tel}?text=${encodeURIComponent(msg(r, url))}`, "_blank");
    } else if (medio === "correo") {
      window.location.href = `mailto:${r.correo ?? ""}?subject=${encodeURIComponent("Evaluación de servicio ESC")}&body=${encodeURIComponent(msg(r, url))}`;
    } else {
      await navigator.clipboard?.writeText(url).catch(() => {});
      setNotice({ tone: "success", text: "Link copiado. Pégalo donde lo vayas a mandar." });
    }
    if (!e.enviada_at) {
      const res = await marcarEncuestaEnviadaAction(e.id, medio);
      if (res.ok) setEnc(r.customer_id, { enviada_at: new Date().toISOString(), medio });
    }
  }

  return (
    <div className="space-y-3">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 text-xs sm:mx-0 sm:px-0">
        {([["todos", `Todos ${list.length}`], ["sin", `Sin enviar ${list.filter((r) => !r.encuesta?.enviada_at).length}`], ["enviadas", `Esperando respuesta ${list.filter((r) => r.encuesta?.enviada_at && !r.encuesta.respondida_at).length}`], ["respondidas", `Respondidas ${list.filter((r) => r.encuesta?.respondida_at).length}`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setVer(k)} className={`shrink-0 rounded-full border px-3 py-1.5 font-medium ${ver === k ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{l}</button>
        ))}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        {shown.length === 0 ? (
          <EmptyState title="Sin clientes en esta vista">{list.length === 0 && "Aquí aparecen tus clientes (con ventas, solicitudes o que diste de alta)."}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((r) => {
              const e = r.encuesta;
              return (
                <li key={r.customer_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-slate-900">{r.nombre}</p>
                    <p className="text-xs text-slate-500">{[r.contacto, r.telefono, r.correo].filter(Boolean).join(" · ") || "Sin contacto"}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
                    {e?.respondida_at ? (
                      <Chip cls={Number(e.puntaje) >= 50 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>Respondió {fecha(e.respondida_at)} · {e.puntaje}%</Chip>
                    ) : e?.token ? (
                      <>
                        {e.enviada_at ? <Chip cls="bg-sky-100 text-sky-800">Enviada {fecha(e.enviada_at)}{e.medio ? ` por ${e.medio}` : ""}</Chip> : <Chip cls="bg-amber-100 text-amber-900">Link listo, sin enviar</Chip>}
                        {activa && (
                          <>
                            <button type="button" onClick={() => enviar(r, "whatsapp")} className="rounded-full bg-green-600 px-2.5 py-1 font-medium text-white hover:bg-green-700">WhatsApp</button>
                            <button type="button" onClick={() => enviar(r, "correo")} className="rounded-full border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-100">Correo</button>
                            <button type="button" onClick={() => enviar(r, "otro")} className="rounded-full border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-100">Copiar link</button>
                          </>
                        )}
                      </>
                    ) : activa ? (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => run(r.customer_id, async () => {
                          const res = await generarEncuestaAction(r.customer_id);
                          if (res.ok) setEnc(r.customer_id, { id: res.id, token: res.token });
                          return res;
                        }, () => {})}
                        className="rounded-full bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        {busy === r.customer_id ? "..." : "Generar link"}
                      </button>
                    ) : (
                      <span className="text-slate-400">Sin evaluación</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
