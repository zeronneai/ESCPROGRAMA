"use client";

import { useState } from "react";
import { copyRich } from "@/lib/clipboard";

/** Link publico de quejas: copiar el link, copiarlo listo para la firma de correo o descargar el QR para tarjetas. */
export function QuejasLinkCard({ url, qr }: { url: string; qr: string }) {
  const [ok, setOk] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const aviso = (t: string) => {
    setOk(t);
    setTimeout(() => setOk(null), 2500);
  };
  const copiar = async (firma: boolean) => {
    try {
      if (firma)
        await copyRich({
          html: `<p style="font-family:Arial,sans-serif;font-size:12px;color:#334155">¿Algo no salió bien? <a href="${url}" style="color:#1d4ed8;font-weight:bold">Envíenos su queja aquí</a></p>`,
          text: `¿Algo no salió bien? Envíenos su queja aquí: ${url}`,
        });
      else await copyRich({ html: `<a href="${url}">${url}</a>`, text: url });
      aviso(firma ? "Copiado: pégalo en tu firma de correo" : "Link copiado");
    } catch {
      aviso("No se pudo copiar, selecciona el link a mano");
    }
  };
  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50";
  return (
    <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50 to-sky-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Link de quejas para clientes</p>
          <p className="text-xs text-slate-600">Ponlo en tarjetas, firmas de correo o WhatsApp. Lo que manden llega aquí como <b>Por revisar</b>.</p>
          <a href={url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-sm font-medium text-brand-700 hover:underline">{url}</a>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => copiar(false)}>Copiar link</button>
          <button type="button" className={btn} onClick={() => copiar(true)}>Copiar para firma de correo</button>
          <button type="button" className={btn} onClick={() => setAbierto((x) => !x)}>{abierto ? "Ocultar QR" : "Código QR"}</button>
        </div>
      </div>
      {ok && <p className="mt-2 text-xs font-medium text-green-700">{ok}</p>}
      {abierto && (
        <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR del link de quejas" width={140} height={140} className="h-36 w-36" />
          <div className="space-y-2 text-xs text-slate-600">
            <p>Para tarjetas de presentación o impresos: al escanearlo se abre el formato de queja.</p>
            <a href={qr} download="qr-quejas-esc.png" className="inline-block rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700">Descargar QR (PNG)</a>
          </div>
        </div>
      )}
    </div>
  );
}
