"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Ayudas de todo el portal:
 * 1) Pildora "Guardando..." / "Cargando..." mientras hay una accion del servidor en curso.
 * 2) Si falta un campo obligatorio, lleva la pantalla a ese campo, lo marca en rojo y avisa cual es.
 * 3) Si sale un aviso de error, se acerca a el y lo resalta; si el error menciona un campo, lo marca.
 * 4) Ventanitas de aviso (toast) arriba al centro: window.dispatchEvent(new CustomEvent("esc-toast", { detail }))
 */

type Toast = { id: number; tono: "error" | "success" | "info"; texto: string };
export type ToastDetail = { tono?: Toast["tono"]; texto: string };

export function toast(texto: string, tono: Toast["tono"] = "info") {
  window.dispatchEvent(new CustomEvent<ToastDetail>("esc-toast", { detail: { texto, tono } }));
}

const quitaAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const VACIAS = new Set(["para", "como", "nosotros", "opcional", "conocemos", "obligatorio", "nombre", "numero", "datos", "favor", "este", "esta"]);

/** Texto de la etiqueta de un campo (label, aria-label o placeholder), sin asteriscos. */
function etiqueta(el: HTMLElement): string {
  const input = el as HTMLInputElement;
  const lbl = input.labels?.[0] ?? el.closest("label");
  let t = "";
  if (lbl) {
    const span = lbl.querySelector("span");
    t = (span?.textContent || lbl.textContent || "").trim();
  }
  t = t || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || "";
  return t.replace(/\*/g, "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
}

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function marcar(el: HTMLElement) {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => el.focus({ preventScroll: true }), 250);
  el.classList.remove("campo-falta");
  void el.offsetWidth;
  el.classList.add("campo-falta");
  el.setAttribute("aria-invalid", "true");
  const quitar = () => {
    el.classList.remove("campo-falta");
    el.removeAttribute("aria-invalid");
    el.removeEventListener("input", quitar);
    el.removeEventListener("change", quitar);
  };
  el.addEventListener("input", quitar);
  el.addEventListener("change", quitar);
  setTimeout(() => el.classList.remove("campo-falta"), 2600);
}

/**
 * Lleva la pantalla al campo que falta, lo marca en rojo y avisa con una ventanita.
 * Acepta un selector o el elemento; si es un contenedor, usa su primer campo vacio.
 */
export function irACampo(destino: string | HTMLElement | null, mensaje: string) {
  let el = typeof destino === "string" ? document.querySelector<HTMLElement>(destino) : destino;
  if (el && !el.matches("input, select, textarea")) {
    const campos = [...el.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=checkbox]):not([type=file]), select, textarea")].filter(visible);
    el = campos.find((c) => !(c as HTMLInputElement).value) ?? campos[0] ?? el;
  }
  if (el) marcar(el);
  toast(mensaje, "error");
}

/** Busca el campo que menciona el mensaje de error (por las palabras de su etiqueta). */
function campoDelError(texto: string, cerca: HTMLElement): HTMLElement | null {
  const msg = quitaAcentos(texto);
  const zona = (cerca.closest("form") as HTMLElement | null) ?? cerca.parentElement?.parentElement ?? document.body;
  const campos = [...zona.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")].filter(visible);
  let mejor: HTMLElement | null = null;
  let puntos = 0;
  for (const c of campos) {
    const palabras = quitaAcentos(etiqueta(c)).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !VACIAS.has(w));
    const p = palabras.filter((w) => msg.includes(w)).length;
    const vacio = !(c as HTMLInputElement).value;
    const score = p + (p && vacio ? 0.5 : 0);
    if (p > 0 && score > puntos) {
      puntos = score;
      mejor = c;
    }
  }
  return mejor;
}

export function FeedbackGlobal() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [mostrarPildora, setMostrarPildora] = useState(false);
  const idRef = useRef(0);

  // Ventanitas de aviso
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail;
      if (!d?.texto) return;
      const id = ++idRef.current;
      setToasts((t) => [...t.filter((x) => x.texto !== d.texto).slice(-2), { id, tono: d.tono ?? "info", texto: d.texto }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), d.tono === "error" ? 6000 : 3500);
    };
    window.addEventListener("esc-toast", on);
    return () => window.removeEventListener("esc-toast", on);
  }, []);

  // Acciones del servidor en curso (todas las de Next llevan el encabezado Next-Action).
  useEffect(() => {
    const original = window.fetch;
    const esAccion = (init?: RequestInit) => {
      const h = init?.headers;
      if (!h) return false;
      if (h instanceof Headers) return h.has("Next-Action") || h.has("next-action");
      if (Array.isArray(h)) return h.some(([k]) => k.toLowerCase() === "next-action");
      return Object.keys(h).some((k) => k.toLowerCase() === "next-action");
    };
    const wrapped: typeof fetch = async (input, init) => {
      if (!esAccion(init)) return original(input, init);
      setPendientes((n) => n + 1);
      try {
        return await original(input, init);
      } finally {
        setPendientes((n) => Math.max(0, n - 1));
      }
    };
    window.fetch = wrapped;
    return () => {
      if (window.fetch === wrapped) window.fetch = original;
    };
  }, []);
  useEffect(() => {
    if (pendientes === 0) {
      setMostrarPildora(false);
      return;
    }
    const t = setTimeout(() => setMostrarPildora(true), 350);
    return () => clearTimeout(t);
  }, [pendientes]);

  // Campos obligatorios vacios (validacion del navegador): ir al primero y decir cual falta.
  useEffect(() => {
    let ultimo = 0;
    const onInvalid = (e: Event) => {
      const el = e.target as HTMLElement;
      e.preventDefault();
      const ahora = Date.now();
      if (ahora - ultimo < 400) return; // solo el primero de cada envio
      ultimo = ahora;
      marcar(el);
      const nombre = etiqueta(el);
      const v = (el as HTMLInputElement).validationMessage;
      toast(nombre ? `Falta llenar: ${nombre}` : v || "Falta llenar un campo obligatorio", "error");
    };
    document.addEventListener("invalid", onInvalid, true);
    return () => document.removeEventListener("invalid", onInvalid, true);
  }, []);

  // Avisos de error nuevos: acercarse, resaltarlos y marcar el campo que mencionan.
  useEffect(() => {
    const vistos = new WeakSet<Element>();
    const revisar = (el: Element) => {
      if (vistos.has(el)) return;
      vistos.add(el);
      const caja = el as HTMLElement;
      const texto = (caja.textContent || "").replace(/^!\s*/, "").trim();
      if (!texto) return;
      const campo = campoDelError(texto, caja);
      if (campo) marcar(campo);
      else {
        const r = caja.getBoundingClientRect();
        if (r.top < 70 || r.bottom > window.innerHeight - 70) caja.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      caja.classList.add("alerta-pulso");
      const enPantalla = (() => {
        const r = caja.getBoundingClientRect();
        return r.top >= 60 && r.bottom <= window.innerHeight;
      })();
      // Si el aviso queda lejos (o se marco un campo), tambien sale la ventanita.
      if (campo || !enPantalla) toast(texto.length > 160 ? `${texto.slice(0, 157)}...` : texto, "error");
    };
    document.querySelectorAll('[data-alerta="error"]').forEach((el) => vistos.add(el));
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          if (n.matches('[data-alerta="error"]')) revisar(n);
          n.querySelectorAll?.('[data-alerta="error"]').forEach(revisar);
        });
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  const color = { error: "border-red-200 bg-white text-red-800", success: "border-green-200 bg-white text-green-800", info: "border-brand-200 bg-white text-brand-900" };
  const bola = { error: "bg-red-600", success: "bg-green-600", info: "bg-brand-600" };
  const icono = { error: "!", success: "✓", info: "i" };
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex flex-col items-center gap-2 px-4" aria-live="assertive">
        {toasts.map((t) => (
          <div key={t.id} role={t.tono === "error" ? "alert" : "status"} className={`toast-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${color[t.tono]}`}>
            <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${bola[t.tono]}`} aria-hidden>{icono[t.tono]}</span>
            <span className="min-w-0 flex-1">{t.texto}</span>
            <button type="button" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="-mr-1 shrink-0 rounded px-1 text-slate-400 hover:text-slate-700" aria-label="Cerrar">×</button>
          </div>
        ))}
      </div>
      {mostrarPildora && (
        <div className="toast-in pointer-events-none fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 md:bottom-6" role="status" aria-live="polite">
          <span className="flex items-center gap-2 rounded-full bg-brand-950/90 px-4 py-2 text-sm font-medium text-white shadow-lg ring-1 ring-white/10 backdrop-blur">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Cargando...
          </span>
        </div>
      )}
    </>
  );
}
