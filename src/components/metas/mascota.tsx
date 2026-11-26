"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Pantalla de las teles: mantiene la pantalla encendida (Wake Lock) y un monito que camina y suelta
 * mensajes con los datos en vivo, para que la pantalla no se vea quieta.
 */
export function MascotaMetas({ mensajes }: { mensajes: string[] }) {
  const [i, setI] = useState(0);
  const [lado, setLado] = useState<"izq" | "der">("izq");
  const lista = useMemo(() => (mensajes.length ? mensajes : ["¡Vamos por la meta!"]), [mensajes]);

  // Que la pantalla no se apague mientras esta abierta.
  useEffect(() => {
    type WL = { release: () => Promise<void> };
    let lock: WL | null = null;
    const pedir = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WL> } };
        if (nav.wakeLock && document.visibilityState === "visible") lock = await nav.wakeLock.request("screen");
      } catch {
        // el navegador no lo permite: sigue el monito moviendose
      }
    };
    void pedir();
    const vis = () => { if (document.visibilityState === "visible") void pedir(); };
    document.addEventListener("visibilitychange", vis);
    const re = window.setInterval(() => void pedir(), 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.clearInterval(re);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => {
      setI((x) => (x + 1) % lista.length);
      setLado((l) => (l === "izq" ? "der" : "izq"));
    }, 9000);
    return () => window.clearInterval(t);
  }, [lista.length]);

  return (
    <div className="pointer-events-none fixed bottom-4 left-0 right-0 z-[60] h-40" aria-hidden>
      <style>{`
        @keyframes mm-camina-der { from { transform: translateX(4vw); } to { transform: translateX(calc(92vw - 150px)); } }
        @keyframes mm-camina-izq { from { transform: translateX(calc(92vw - 150px)); } to { transform: translateX(4vw); } }
        @keyframes mm-brinca { 0%,100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-10px) rotate(3deg); } }
        @keyframes mm-brazo { 0%,100% { transform: rotate(-25deg); } 50% { transform: rotate(35deg); } }
        @keyframes mm-burbuja { 0% { opacity: 0; transform: translateY(8px) scale(.9); } 12%,85% { opacity: 1; transform: none; } 100% { opacity: 0; } }
        @keyframes mm-parpadeo { 0%,92%,100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
      `}</style>
      <div key={`${i}-${lado}`} className="absolute bottom-0" style={{ animation: `${lado === "der" ? "mm-camina-der" : "mm-camina-izq"} 8.5s ease-in-out forwards` }}>
        <div className="relative w-[150px]">
          <div
            className="absolute bottom-[132px] left-1/2 w-[min(420px,80vw)] -translate-x-1/2 rounded-2xl border-2 border-brand-300 bg-white px-4 py-2.5 text-center text-base font-bold text-slate-800 shadow-xl"
            style={{ animation: "mm-burbuja 8.5s ease-in-out forwards" }}
          >
            {lista[i]}
            <span className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-brand-300 bg-white" />
          </div>
          <div style={{ transform: lado === "izq" ? "scaleX(-1)" : undefined }}>
          <svg viewBox="-4 -6 128 136" width="150" height="130" style={{ animation: "mm-brinca .7s ease-in-out infinite" }}>
            <defs>
              <linearGradient id="mm-cuerpo" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#60a5fa" /><stop offset="1" stopColor="#1d4ed8" /></linearGradient>
              <radialGradient id="mm-brillo" cx=".35" cy=".3" r=".7"><stop offset="0" stopColor="#ffffff" stopOpacity=".8" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" /></radialGradient>
            </defs>
            <ellipse cx="60" cy="126" rx="30" ry="4" fill="#0f172a" opacity=".15" />
            {/* piernas */}
            <rect x="42" y="98" width="10" height="22" rx="5" fill="#1e3a8a" />
            <rect x="68" y="98" width="10" height="22" rx="5" fill="#1e3a8a" />
            {/* cuerpo */}
            <rect x="28" y="52" width="64" height="52" rx="18" fill="url(#mm-cuerpo)" />
            <rect x="28" y="52" width="64" height="52" rx="18" fill="url(#mm-brillo)" />
            {/* grafica en la panza */}
            <rect x="42" y="66" width="36" height="26" rx="5" fill="#fff" opacity=".95" />
            <rect x="47" y="80" width="6" height="8" rx="1" fill="#f59e0b" />
            <rect x="57" y="75" width="6" height="13" rx="1" fill="#16a34a" />
            <rect x="67" y="70" width="6" height="18" rx="1" fill="#2563eb" />
            {/* brazo que saluda */}
            <g style={{ transformOrigin: "92px 62px", animation: "mm-brazo .9s ease-in-out infinite" }}>
              <rect x="90" y="58" width="22" height="9" rx="4.5" fill="#2563eb" />
              <circle cx="113" cy="62" r="6" fill="#fbbf24" />
            </g>
            <rect x="8" y="62" width="22" height="9" rx="4.5" fill="#2563eb" />
            {/* cabeza */}
            <rect x="30" y="8" width="60" height="46" rx="20" fill="url(#mm-cuerpo)" />
            <rect x="30" y="8" width="60" height="46" rx="20" fill="url(#mm-brillo)" />
            <line x1="60" y1="8" x2="60" y2="0" stroke="#1e3a8a" strokeWidth="3" />
            <circle cx="60" cy="0" r="4" fill="#f43f5e" />
            <rect x="38" y="18" width="44" height="26" rx="12" fill="#0f172a" />
            <g style={{ transformOrigin: "60px 30px", animation: "mm-parpadeo 4s infinite" }}>
              <circle cx="50" cy="30" r="5" fill="#67e8f9" />
              <circle cx="70" cy="30" r="5" fill="#67e8f9" />
            </g>
            <path d="M52 38 Q60 43 68 38" stroke="#67e8f9" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
