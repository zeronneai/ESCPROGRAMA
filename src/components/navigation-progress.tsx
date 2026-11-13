"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Barra de progreso fina arriba de la pantalla mientras se carga una pagina.
 * Arranca al hacer clic en un enlace interno o al enviar un filtro (form GET) y termina
 * cuando cambia la URL. Si la navegacion no ocurre, se apaga sola a los 12 s.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const start = () => {
      setState("loading");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 12_000);
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      start();
    };
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement;
      if (e.defaultPrevented || (f.method || "get").toLowerCase() !== "get") return;
      start();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setState((s) => (s === "loading" ? "done" : s));
    const t = setTimeout(() => setState((s) => (s === "done" ? "idle" : s)), 350);
    return () => clearTimeout(t);
  }, [pathname, search]);

  if (state === "idle") return null;
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-1" role="progressbar" aria-label="Cargando">
        <div
          className={`h-full bg-gradient-to-r from-sky-400 via-brand-500 to-brand-700 ${state === "loading" ? "nav-progress-run" : "w-full opacity-0 transition-opacity duration-300"}`}
        />
      </div>
      {state === "loading" && <PildoraLenta />}
    </>
  );
}

/** Si la pagina tarda, sale una pildora con el circulo girando para que se note que esta cargando. */
function PildoraLenta() {
  const [ver, setVer] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVer(true), 450);
    return () => clearTimeout(t);
  }, []);
  if (!ver) return null;
  return (
    <div className="toast-in pointer-events-none fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 md:bottom-6" role="status" aria-live="polite">
      <span className="flex items-center gap-2 rounded-full bg-brand-950/90 px-4 py-2 text-sm font-medium text-white shadow-lg ring-1 ring-white/10 backdrop-blur">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        Cargando...
      </span>
    </div>
  );
}
