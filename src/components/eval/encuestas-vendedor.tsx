"use client";

import { useState } from "react";
import { generarEncuestaAction, marcarEncuestaEnviadaAction } from "@/actions/evaluaciones";
import { Chip, useRun } from "@/components/ops-ui";
import { Alert, EmptyState } from "@/components/ui";
import { ENCUESTA_ESTADO, encuestaEstado, encuestaUrl } from "@/lib/evaluaciones";

export interface ClienteEncuesta {
  customer_id: string;
  nombre: string;
  contacto: string | null;
  telefono: string | null;
  correo: string | null;
  encuesta: { id: string; token: string; enviada_at: string | null; medio: string | null; respondida_at: string | null; puntaje: number | null } | null;
}

type Medio = "whatsapp" | "correo" | "otro";
const fecha = (d: string) => new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
const MEDIO: Record<string, string> = { whatsapp: "WhatsApp", correo: "correo", otro: "link copiado" };

/** Vendedor: un link por cliente. Al copiarlo o mandarlo queda Enviada; cuando el cliente contesta, Recibida. */
export function EncuestasVendedor({ rows, origin, activa, vendedor }: { rows: ClienteEncuesta[]; origin: string; activa: boolean; vendedor: string }) {
  const [list, setList] = useState(rows);
  const [ver, setVer] = useState<"todos" | "sin_enviar" | "enviada" | "recibida">("todos");
  const [manual, setManual] = useState<{ nombre: string; url: string } | null>(null);
  const { busy, notice, setNotice } = useRun();
  const [working, setWorking] = useState<string | null>(null);
  const setEnc = (cid: string, patch: Partial<NonNullable<ClienteEncuesta["encuesta"]>>) =>
    setList((l) => l.map((r) => (r.customer_id === cid ? { ...r, encuesta: { ...(r.encuesta ?? { id: "", token: "", enviada_at: null, medio: null, respondida_at: null, puntaje: null }), ...patch } } : r)));
  const count = (k: string) => list.filter((r) => encuestaEstado(r.encuesta) === k).length;
  const shown = list.filter((r) => ver === "todos" || encuestaEstado(r.encuesta) === ver);
  const msg = (r: ClienteEncuesta, url: string) =>
    `Hola${r.contacto ? ` ${r.contacto.split(" ")[0]}` : ""}, en ESC Representaciones queremos mejorar. ¿Nos ayuda con nuestra encuesta de satisfacción? Son 10 preguntas rápidas: ${url} Gracias. ${vendedor}`;

  async function enviar(r: ClienteEncuesta, medio: Medio) {
    setNotice(null);
    setManual(null);
    // WhatsApp: se abre la ventana antes de esperar al servidor para que el navegador no la bloquee.
    const win = medio === "whatsapp" ? window.open("about:blank", "_blank") : null;
    setWorking(r.customer_id);
    try {
      let e = r.encuesta;
      if (!e?.token) {
        const res = await generarEncuestaAction(r.customer_id);
        if (!res.ok) {
          win?.close();
          setNotice({ tone: "error", text: res.error });
          return;
        }
        e = { id: res.id, token: res.token, enviada_at: null, medio: null, respondida_at: null, puntaje: null };
        setEnc(r.customer_id, { id: res.id, token: res.token });
      }
      const url = encuestaUrl(origin, e.token);
      if (medio === "whatsapp") {
        const tel = (r.telefono ?? "").replace(/\D/g, "");
        const href = `https://wa.me/${tel.length === 10 ? `52${tel}` : tel}?text=${encodeURIComponent(msg(r, url))}`;
        if (win) win.location.href = href;
        else window.open(href, "_blank");
      } else if (medio === "correo") {
        window.location.href = `mailto:${r.correo ?? ""}?subject=${encodeURIComponent("Encuesta de satisfacción ESC Representaciones")}&body=${encodeURIComponent(msg(r, url))}`;
      } else {
        const ok = await navigator.clipboard?.writeText(url).then(() => true).catch(() => false);
        if (ok) setNotice({ tone: "success", text: `Link de ${r.nombre} copiado. Pégalo donde lo vayas a mandar.` });
        else setManual({ nombre: r.nombre, url });
      }
      if (!e.enviada_at) {
        const res = await marcarEncuestaEnviadaAction(e.id, medio);
        if (res.ok) setEnc(r.customer_id, { enviada_at: new Date().toISOString(), medio });
      }
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="space-y-3">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {manual && (
        <Alert tone="info">
          Copia el link de {manual.nombre}:{" "}
          <input readOnly value={manual.url} onFocus={(e) => e.currentTarget.select()} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
        </Alert>
      )}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 text-xs sm:mx-0 sm:px-0">
        {([["todos", `Todos ${list.length}`], ["sin_enviar", `Sin enviar ${count("sin_enviar")}`], ["enviada", `Enviadas ${count("enviada")}`], ["recibida", `Recibidas ${count("recibida")}`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setVer(k)} className={`shrink-0 rounded-full border px-3 py-1.5 font-medium ${ver === k ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{l}</button>
        ))}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        {shown.length === 0 ? (
          <EmptyState title="Sin clientes en esta vista">{list.length === 0 && "Aquí aparecen tus clientes (con ventas, solicitudes o que diste de alta), incluidas sus sucursales."}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((r) => {
              const e = r.encuesta;
              const st = encuestaEstado(e);
              const dis = !!busy || working === r.customer_id;
              return (
                <li key={r.customer_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      {r.nombre}
                      <Chip cls={ENCUESTA_ESTADO[st].cls}>
                        {ENCUESTA_ESTADO[st].label}
                        {st === "enviada" && e?.enviada_at ? ` ${fecha(e.enviada_at)}${e.medio ? ` (${MEDIO[e.medio] ?? e.medio})` : ""}` : ""}
                        {st === "recibida" && e?.respondida_at ? ` ${fecha(e.respondida_at)} · ${e.puntaje}%` : ""}
                      </Chip>
                    </p>
                    <p className="text-xs text-slate-500">{[r.contacto, r.telefono, r.correo].filter(Boolean).join(" · ") || "Sin contacto"}</p>
                  </div>
                  {st !== "recibida" && activa && (
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
                      <button type="button" disabled={dis} onClick={() => enviar(r, "otro")} className="rounded-full bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                        {working === r.customer_id ? "..." : "Copiar link"}
                      </button>
                      {r.telefono && <button type="button" disabled={dis} onClick={() => enviar(r, "whatsapp")} className="rounded-full bg-green-600 px-2.5 py-1.5 font-medium text-white hover:bg-green-700 disabled:opacity-50">WhatsApp</button>}
                      {r.correo && <button type="button" disabled={dis} onClick={() => enviar(r, "correo")} className="rounded-full border border-slate-300 px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-50">Correo</button>}
                    </div>
                  )}
                  {st !== "recibida" && !activa && <span className="text-xs text-slate-400">Encuesta cerrada</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
