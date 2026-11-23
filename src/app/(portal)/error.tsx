"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Si una pantalla falla al cargar (se cayo la conexion, la base tardo de mas), en vez de quedarse
 * en blanco o regresar a Inicio se dice que paso y se ofrece intentar de nuevo.
 */
export default function ErrorPortal({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-sm">
      <p className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl font-bold text-amber-700">!</p>
      <h1 className="text-lg font-semibold text-slate-900">No se pudo cargar esta pantalla</h1>
      <p className="text-sm text-slate-600">Puede ser la conexión o que el sistema tardó de más. Lo que ya habías guardado no se pierde.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => reset()} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">Intentar de nuevo</button>
        <button type="button" onClick={() => location.reload()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Recargar la página</button>
        <Link href="/inicio" className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-slate-800">Ir a Inicio</Link>
      </div>
      {error.digest && <p className="text-xs text-slate-400">Código: {error.digest}</p>}
    </div>
  );
}
