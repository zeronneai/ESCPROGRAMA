"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { crearOcAction, guardarReglasAsistenteAction } from "@/actions/planeacion";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import type { OcPropuesta, Propuesta } from "@/lib/asistente-compras";
import { fechaCortaMx, fmtNum } from "@/lib/planeacion";
import { Markdown } from "./markdown";

type Msg = { role: "user" | "assistant"; content: string; propuesta?: Propuesta | null; error?: boolean };

const LLAVE = "esc-asistente-compras";
const SUGERENCIAS = [
  "¿Cuántas OCs tengo abiertas y cuáles ya debieron llegar?",
  "¿Qué artículos se acaban antes de que llegue un pedido?",
  "Arma las OCs de los americanos para recuperar stock, una cada 2 semanas, máximo 30,000 USD cada una",
  "¿Qué me pidieron los vendedores?",
];

/** Texto que se manda al modelo por cada mensaje (la propuesta va resumida para que la recuerde). */
function paraModelo(m: Msg): string {
  if (!m.propuesta?.ocs.length) return m.content;
  const res = m.propuesta.ocs.map((o) => `${o.proveedor} ${o.fecha}: ${o.lineas.length} renglones, $${Math.round(o.importe)} USD (${o.lineas.map((l) => `${l.clave} x${l.cantidad}`).join(", ")})`).join("; ");
  return `${m.content}\n\n[Propuesta mostrada al comprador: ${res}]`;
}

export function AsistenteCompras({ reglasIniciales, hoy, configurado }: { reglasIniciales: string; hoy: string; configurado: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [paso, setPaso] = useState("");
  const [reglas, setReglas] = useState(reglasIniciales);
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const g = localStorage.getItem(LLAVE);
      if (g) setMsgs(JSON.parse(g) as Msg[]);
    } catch {
      // sin almacenamiento: empieza vacio
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LLAVE, JSON.stringify(msgs.slice(-40)));
    } catch {
      // nada
    }
    fin.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, paso]);

  async function enviar(t = texto) {
    const pregunta = t.trim();
    if (!pregunta || enviando) return;
    const lista: Msg[] = [...msgs, { role: "user", content: pregunta }];
    setMsgs(lista);
    setTexto("");
    setEnviando(true);
    setPaso("Pensando");
    let respuesta = "";
    let propuesta: Propuesta | null = null;
    let error = "";
    try {
      const historial = lista.filter((m) => !m.error).slice(-20).map((m) => ({ role: m.role, content: paraModelo(m) }));
      // El historial debe empezar con el comprador.
      while (historial.length && historial[0].role !== "user") historial.shift();
      const r = await fetch("/api/planeacion/asistente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mensajes: historial }) });
      if (!r.ok || !r.body) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Error ${r.status}`);
      }
      const lector = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let k;
        while ((k = buf.indexOf("\n")) >= 0) {
          const linea = buf.slice(0, k).trim();
          buf = buf.slice(k + 1);
          if (!linea) continue;
          const ev = JSON.parse(linea) as { t: string; texto?: string; propuesta?: Propuesta; error?: string; reglas?: string };
          if (ev.t === "paso") setPaso(ev.texto ?? "");
          else if (ev.t === "texto") respuesta = ev.texto ?? "";
          else if (ev.t === "propuesta") propuesta = ev.propuesta ?? null;
          else if (ev.t === "reglas") setReglas(ev.reglas ?? "");
          else if (ev.t === "error") error = ev.error ?? "Error";
        }
      }
    } catch (e) {
      error = (e as Error).message || "No pude conectar con el asistente.";
    }
    setMsgs([...lista, error && !respuesta ? { role: "assistant", content: error, error: true } : { role: "assistant", content: respuesta || error, propuesta }]);
    setEnviando(false);
    setPaso("");
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-h-[60vh] min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!configurado && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Falta la clave de Claude: agrega <code>ANTHROPIC_API_KEY</code> en Vercel (Settings, Environment Variables) y vuelve a publicar.
            </p>
          )}
          {!msgs.length && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Pregúntame lo que quieras de tus compras o pídeme un plan de órdenes de compra. Yo consulto la planeación real; las OCs que proponga solo se generan cuando tú le das al botón.</p>
              <div className="flex flex-wrap gap-2">
                {SUGERENCIAS.map((s) => (
                  <button key={s} type="button" disabled={!configurado} onClick={() => enviar(s)} className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-left text-sm text-brand-900 hover:bg-brand-100 disabled:opacity-50">{s}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2 text-sm text-white">{m.content}</div>
            ) : (
              <div key={i} className="max-w-full space-y-3">
                {m.propuesta?.ocs.length ? <TarjetaPropuesta p={m.propuesta} hoy={hoy} /> : null}
                <div className={`rounded-2xl rounded-bl-sm px-3.5 py-2 ${m.error ? "bg-red-50 text-red-800" : "bg-slate-50"}`}>{m.error ? <p className="text-sm">{m.content}</p> : <Markdown texto={m.content} />}</div>
              </div>
            ),
          )}
          {enviando && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />
              {paso || "Pensando"}…
            </div>
          )}
          <div ref={fin} />
        </div>
        <form
          className="flex items-end gap-2 border-t border-slate-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
        >
          <textarea
            className="min-h-[44px] flex-1 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            rows={2}
            value={texto}
            placeholder="Ej. ¿Cuánto llevo pedido a TopGlove este mes? / Ahora el tope baja a 25,000"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            disabled={enviando || !configurado}
            aria-label="Mensaje para el asistente"
          />
          <Button type="submit" loading={enviando} disabled={!texto.trim() || !configurado}>Enviar</Button>
        </form>
        {msgs.length > 0 && (
          <button type="button" className="self-start px-3 pb-3 text-xs text-slate-500 underline" onClick={() => setMsgs([])} disabled={enviando}>Nueva conversación</button>
        )}
      </div>
      <Reglas reglas={reglas} setReglas={setReglas} />
    </div>
  );
}

function Reglas({ reglas, setReglas }: { reglas: string; setReglas: (s: string) => void }) {
  const [pend, start] = useTransition();
  return (
    <aside className="space-y-2 self-start rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Reglas que recuerda</h2>
      <p className="text-xs text-slate-500">Las sigue en cada plan. Puedes escribirlas aquí o decírselo en el chat (&quot;recuerda que el tope ahora es 25,000&quot;).</p>
      <textarea
        className="h-56 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        value={reglas}
        maxLength={8000}
        onChange={(e) => setReglas(e.target.value)}
        placeholder={"- Americanos: una OC cada 2 semanas\n- Tope 30,000 USD por OC\n- TopGlove: priorizar guantes de nitrilo"}
      />
      <Button
        type="button"
        variant="secondary"
        loading={pend}
        onClick={() =>
          start(async () => {
            const r = await guardarReglasAsistenteAction(reglas);
            if (!r.ok) return toast(r.error, "error");
            toast("Reglas guardadas", "success");
          })
        }
      >
        Guardar reglas
      </Button>
    </aside>
  );
}

function TarjetaPropuesta({ p, hoy }: { p: Propuesta; hoy: string }) {
  const total = p.ocs.reduce((s, o) => s + o.importe, 0);
  return (
    <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
      <div>
        <p className="text-sm font-semibold text-violet-900">Propuesta: {p.ocs.length} OC{p.ocs.length === 1 ? "" : "s"} · ${fmtNum(total)} USD</p>
        {p.resumen && <p className="text-xs text-violet-900/80">{p.resumen}</p>}
      </div>
      {p.ocs.map((o, i) => <OcProp key={i} o={o} hoy={hoy} />)}
    </div>
  );
}

function OcProp({ o, hoy }: { o: OcPropuesta; hoy: string }) {
  const [pend, start] = useTransition();
  const [creada, setCreada] = useState<{ id: string; folio: string } | null>(null);
  const [ver, setVer] = useState(false);
  const pasa = o.tope != null && o.importe > o.tope * 1.001;
  const futura = o.fecha > hoy;
  const generar = () =>
    start(async () => {
      const r = await crearOcAction(o.proveedor_id, o.lineas.map((l) => ({ clave: l.clave, cantidad: l.cantidad, precio: l.precio })), o.nota ? `Asistente: ${o.nota}` : "Propuesta del asistente de compras");
      if (!r.ok) return toast(r.error, "error");
      setCreada({ id: r.id, folio: r.folio });
      toast(`OC ${r.folio} creada en borrador`, "success");
    });
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{o.proveedor} · emitir {o.fecha === hoy ? "hoy" : fechaCortaMx(o.fecha)}</p>
          <p className="text-xs text-slate-600">
            {o.lineas.length} artículos · <b className={pasa ? "text-red-700" : ""}>${fmtNum(o.importe)} USD</b>
            {o.tope ? ` de tope $${fmtNum(o.tope)}` : ""}
            {o.cbm ? ` · ${fmtNum(o.cbm, 1)} CBM` : ""}
          </p>
          {o.nota && <p className="text-xs text-slate-500">{o.nota}</p>}
        </div>
        {creada ? (
          <Link href={`/comprador/planeacion/oc/${creada.id}`} className="rounded-lg bg-green-100 px-3 py-1.5 text-sm font-semibold text-green-800 underline">{creada.folio} creada →</Link>
        ) : (
          <Button type="button" onClick={generar} loading={pend} variant={futura ? "secondary" : "primary"}>Generar OC en borrador</Button>
        )}
      </div>
      {futura && !creada && <p className="mt-1 text-[11px] text-amber-800">Es para más adelante: mejor genérala ese día (en borrador ya cuenta como en camino).</p>}
      <button type="button" className="mt-1 text-xs text-brand-700 underline" onClick={() => setVer(!ver)}>{ver ? "Ocultar artículos" : "Ver artículos"}</button>
      {ver && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-slate-500"><tr><th className="py-1 text-left">Clave</th><th className="py-1 text-left">Artículo</th><th className="py-1 text-right">Cantidad</th><th className="py-1 text-right">Importe</th></tr></thead>
            <tbody>
              {o.lineas.map((l) => (
                <tr key={l.clave} className="border-t border-slate-100">
                  <td className="whitespace-nowrap py-1 pr-2 font-medium">{l.clave}</td>
                  <td className="max-w-[260px] truncate py-1 pr-2 text-slate-600">{l.nombre}</td>
                  <td className="py-1 pl-2 text-right">{fmtNum(l.cantidad)}</td>
                  <td className="whitespace-nowrap py-1 pl-2 text-right">{l.importe ? `$${fmtNum(l.importe)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
