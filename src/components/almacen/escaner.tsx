"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Sonido corto: agudo si salio bien, grave si no. */
export function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = ok ? "sine" : "square";
    o.frequency.value = ok ? 1200 : 220;
    g.gain.value = 0.15;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.12 : 0.45));
    o.onended = () => void ctx.close();
    if (!ok && "vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
  } catch {
    /* sin audio */
  }
}

/**
 * Entrada de escaneo: lector USB o Bluetooth (escribe el codigo y Enter en la caja) o la camara del celular.
 * Ignora el mismo codigo repetido en menos de 2.5 segundos.
 */
export function Escaner({ onCodigo, disabled = false, placeholder = "Escanea o escribe el código de la etiqueta" }: { onCodigo: (texto: string) => Promise<void> | void; disabled?: boolean; placeholder?: string }) {
  const [texto, setTexto] = useState("");
  const [camara, setCamara] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const ultimo = useRef<{ t: string; at: number }>({ t: "", at: 0 });
  const ocupado = useRef(false);

  const procesar = useCallback(
    async (raw: string) => {
      const t = raw.trim();
      if (!t || disabled || ocupado.current) return;
      const now = Date.now();
      if (ultimo.current.t === t && now - ultimo.current.at < 2500) return;
      ultimo.current = { t, at: now };
      ocupado.current = true;
      try {
        await onCodigo(t);
      } finally {
        ocupado.current = false;
      }
    },
    [onCodigo, disabled],
  );

  useEffect(() => {
    if (!camara) return;
    let stop: (() => void) | null = null;
    let vivo = true;
    setCamError(null);
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          video.current!,
          (res) => {
            if (res) void procesar(res.getText());
          },
        );
        if (!vivo) controls.stop();
        else stop = () => controls.stop();
      } catch (e) {
        const msg = (e as Error)?.name === "NotAllowedError" ? "Da permiso de usar la cámara en el navegador." : "No se pudo abrir la cámara de este dispositivo.";
        setCamError(msg);
        setCamara(false);
      }
    })();
    return () => {
      vivo = false;
      stop?.();
    };
  }, [camara, procesar]);

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = texto;
          setTexto("");
          void procesar(t);
          input.current?.focus();
        }}
      >
        <input
          ref={input}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoFocus
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="characters"
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-md border-2 border-brand-600 px-3 py-2.5 font-mono text-base focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-50"
        />
        <button type="submit" disabled={disabled || !texto.trim()} className="rounded-md bg-brand-600 px-4 text-sm font-medium text-white disabled:opacity-50">OK</button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setCamara((c) => !c)}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${camara ? "bg-slate-800 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7h3l2-3h8l2 3h3v13H3z" /><circle cx="12" cy="13" r="4" /></svg>
          {camara ? "Apagar cámara" : "Escanear con la cámara"}
        </button>
        <span className="text-xs text-slate-500">Con lector: deja el cursor en la caja y escanea.</span>
      </div>
      {camError && <p className="text-sm text-red-700">{camError}</p>}
      {camara && (
        <div className="relative mx-auto max-w-sm overflow-hidden rounded-lg bg-black">
          <video ref={video} className="aspect-square w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-[18%] rounded-lg border-4 border-white/80" />
        </div>
      )}
    </div>
  );
}
