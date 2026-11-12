"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { catalogoVistoAction, comentarCatalogoAction } from "@/actions/catalogo";
import { EnviarCatalogo } from "@/components/catalogo";
import { CATALOGO } from "@/lib/marca";

/** Evento para abrir la ventana del catalogo desde otro lado (por ejemplo "Dejar comentario"). */
export const ABRIR_CATALOGO = "esc-abrir-catalogo";

export function CatalogoPopup({ abierto, vende, comprador }: { abierto: boolean; vende: boolean; comprador: boolean }) {
  const [open, setOpen] = useState(abierto);
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; text: string } | null>(null);

  // Llega en tiempo real: al refrescarse el portal por la notificacion, se abre.
  useEffect(() => {
    if (abierto) setOpen(true);
  }, [abierto]);
  useEffect(() => {
    const abrir = () => { setAviso(null); setOpen(true); };
    window.addEventListener(ABRIR_CATALOGO, abrir);
    return () => window.removeEventListener(ABRIR_CATALOGO, abrir);
  }, []);

  async function cerrar() {
    setOpen(false);
    if (abierto) await catalogoVistoAction().catch(() => null);
  }
  async function enviar() {
    setBusy(true);
    setAviso(null);
    const r = await comentarCatalogoAction(texto).catch(() => ({ ok: false as const, error: "No se pudo enviar. Revisa tu conexión." }));
    setBusy(false);
    if (!r.ok) return setAviso({ ok: false, text: r.error });
    setTexto("");
    setAviso({ ok: true, text: "¡Gracias! Tu comentario ya le llegó a compras." });
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && void cerrar()}>
      <div role="dialog" aria-modal="true" aria-label="Catálogo ESC 2026" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="rounded-t-2xl bg-gradient-to-br from-[#0f2f7a] to-[#1d5fd6] px-5 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Nuevo</p>
          <p className="mt-1 text-xl font-bold">Ya está el {CATALOGO.nombre}</p>
          <p className="mt-1 text-sm text-white/85">Ya lo pueden usar: ábrelo, revísalo y compártelo con tus clientes.</p>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap gap-2">
            <a href={CATALOGO.archivo} target="_blank" rel="noreferrer" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Ver catálogo</a>
            {vende && <EnviarCatalogo compacto />}
          </div>
          {comprador ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              Los comentarios que deje el equipo te llegan aquí: <Link href="/comprador/catalogo" onClick={() => void cerrar()} className="font-semibold text-brand-700 underline">Comentarios del catálogo</Link>.
            </p>
          ) : (
            <div className="space-y-2">
              <label htmlFor="cat-coment" className="block text-sm font-medium text-slate-800">¿Viste algo que corregir o una sugerencia? Déjala aquí para compras</label>
              <textarea id="cat-coment" value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={2000} placeholder="Ej. En la página 12 falta la talla XL del guante..." className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              {aviso && <p className={`text-sm font-medium ${aviso.ok ? "text-green-700" : "text-red-700"}`}>{aviso.text}</p>}
              <button type="button" disabled={busy || texto.trim().length < 3} onClick={() => void enviar()} className="rounded-md border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50">{busy ? "Enviando..." : "Enviar comentario"}</button>
            </div>
          )}
          <div className="flex justify-end border-t border-slate-100 pt-3">
            <button type="button" onClick={() => void cerrar()} className="rounded-md bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800">Listo</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Boton para volver a abrir la ventana y dejar un comentario. */
export function DejarComentarioCatalogo() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(ABRIR_CATALOGO))} className="text-sm font-medium text-brand-700 underline hover:text-brand-800">
      Dejar comentario o sugerencia
    </button>
  );
}
