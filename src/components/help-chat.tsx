"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Rol } from "@/lib/auth/route-guard";
import { searchFaq, suggestions, type Faq } from "@/lib/ayuda/faq";

type Msg = { from: "bot" | "me"; text?: string; faq?: Faq; others?: Faq[] };

/** Asistente de ayuda del portal (respuestas guardadas, sin IA). */
export function HelpChat({ rol, nombre }: { rol: Rol; nombre: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const sug = suggestions(rol, path);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs, open]);

  function ask(q: string, faq?: Faq) {
    const query = q.trim();
    if (!query) return;
    const r = faq ? { best: faq, others: [] } : searchFaq(query, rol, path);
    setMsgs((m) => [
      ...m,
      { from: "me", text: query },
      r.best
        ? { from: "bot", faq: r.best, others: r.others }
        : { from: "bot", text: "No encontré algo sobre eso. Prueba con otras palabras (por ejemplo \"registrar venta\", \"pedir guía\" o \"queja\"), o elige una de estas:", others: sug },
    ]);
    setText("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Cerrar ayuda" : "Abrir ayuda"}
        className="fixed bottom-[calc(9rem+env(safe-area-inset-bottom))] right-3 z-40 flex h-11 w-11 md:h-12 md:w-12 md:right-6 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700 md:bottom-6"
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
        ) : (
          <span className="text-xl font-bold leading-none">?</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-2 top-16 bottom-[calc(12.5rem+env(safe-area-inset-bottom))] z-40 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl md:inset-x-auto md:top-auto md:right-6 md:bottom-20 md:max-h-[70vh] md:w-96">
          <div className="border-b border-slate-100 bg-brand-600 px-4 py-3 text-white">
            <p className="font-semibold">Ayuda</p>
            <p className="text-xs text-white/80">Pregúntame cómo hacer algo en el portal</p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
            <Bubble>
              Hola {nombre.split(" ")[0]}. Escribe tu duda o elige una pregunta:
              <Chips items={sug} onPick={(f) => ask(f.q, f)} />
            </Bubble>
            {msgs.map((m, i) =>
              m.from === "me" ? (
                <div key={i} className="ml-auto max-w-[85%] rounded-lg bg-brand-600 px-3 py-2 text-white">{m.text}</div>
              ) : (
                <Bubble key={i}>
                  {m.faq ? (
                    <>
                      <p className="font-semibold text-slate-900">{m.faq.q}</p>
                      {m.faq.a.length > 1 ? (
                        <ol className="mt-1 list-decimal space-y-1 pl-4">{m.faq.a.map((x) => <li key={x}>{x}</li>)}</ol>
                      ) : (
                        <p className="mt-1">{m.faq.a[0]}</p>
                      )}
                      {m.faq.links && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {m.faq.links.map((l) => (
                            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700">{l.label}</Link>
                          ))}
                        </div>
                      )}
                      {!!m.others?.length && (
                        <>
                          <p className="mt-3 text-xs text-slate-500">También te puede servir:</p>
                          <Chips items={m.others} onPick={(f) => ask(f.q, f)} />
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {m.text}
                      {!!m.others?.length && <Chips items={m.others} onPick={(f) => ask(f.q, f)} />}
                    </>
                  )}
                </Bubble>
              ),
            )}
            <div ref={end} />
          </div>
          <form
            className="flex gap-2 border-t border-slate-100 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(text);
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej. ¿cómo registro una venta?" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none" />
            <button type="submit" disabled={!text.trim()} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Preguntar</button>
          </form>
        </div>
      )}
    </>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[92%] rounded-lg bg-slate-100 px-3 py-2 text-slate-700">{children}</div>;
}

function Chips({ items, onPick }: { items: Faq[]; onPick: (f: Faq) => void }) {
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {items.map((f) => (
        <button key={f.id} type="button" onClick={() => onPick(f)} className="rounded-md border border-brand-100 bg-white px-2.5 py-1.5 text-left text-xs font-medium text-brand-700 hover:bg-brand-50">
          {f.q}
        </button>
      ))}
    </div>
  );
}
