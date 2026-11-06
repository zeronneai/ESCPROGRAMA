"use client";

import { useEffect, useState } from "react";
import { CATALOGO, mensajeCatalogo } from "@/lib/marca";

/** Botones para mandar el catalogo a un cliente por WhatsApp o correo (se abre la app con el mensaje listo). */
export function EnviarCatalogo({ telefono, correo, contacto, compacto = false }: { telefono?: string | null; correo?: string | null; contacto?: string | null; compacto?: boolean }) {
  const [origen, setOrigen] = useState("");
  const [copiado, setCopiado] = useState(false);
  useEffect(() => setOrigen(window.location.origin), []);
  const url = `${origen}${CATALOGO.ruta}`;
  const texto = mensajeCatalogo(url, contacto);
  let tel = (telefono ?? "").replace(/\D/g, "");
  if (tel.length === 10) tel = `52${tel}`;
  const wa = `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
  const mail = `mailto:${correo ?? ""}?subject=${encodeURIComponent("Catálogo 2026 ESC Representaciones")}&body=${encodeURIComponent(texto)}`;
  const btn = `inline-flex items-center gap-1.5 rounded-md px-3 ${compacto ? "py-1.5 text-xs" : "py-2 text-sm"} font-medium`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={wa} target="_blank" rel="noreferrer" className={`${btn} bg-green-600 text-white hover:bg-green-700`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.6-.1l2 1c.3.1.5.2.5.3.1.2.1.7-.1 1.2Z" /></svg>
        {compacto ? "WhatsApp" : "Enviar catálogo por WhatsApp"}
      </a>
      <a href={mail} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
        {compacto ? "Correo" : "Enviar por correo"}
      </a>
      <button
        type="button"
        className={`${btn} text-brand-700 hover:underline`}
        onClick={() => {
          void navigator.clipboard?.writeText(url);
          setCopiado(true);
          window.setTimeout(() => setCopiado(false), 2000);
        }}
      >
        {copiado ? "¡Liga copiada!" : "Copiar liga"}
      </button>
    </div>
  );
}
