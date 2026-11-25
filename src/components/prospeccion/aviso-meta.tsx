"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EVENTO_CAMBIO } from "@/components/realtime-sync";
import type { AvanceProspeccion } from "@/lib/meta-prospeccion";
import { createClient } from "@/lib/supabase/client";

const DESTINO = "/vendedor/bitacora";
const fechaCorta = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

/**
 * Meta de prospeccion del vendedor: aviso rojo fijo arriba mientras le falten prospectos (acumulado desde el
 * inicio, de lunes a viernes) y una ventana una vez al dia.
 */
export function AvisoMetaProspeccion() {
  const pathname = usePathname();
  const [a, setA] = useState<AvanceProspeccion | null>(null);
  const [popup, setPopup] = useState(false);

  const revisar = useCallback(async () => {
    const { data, error } = await createClient().rpc("prospeccion_avance");
    if (error) return;
    const yo = ((data ?? []) as AvanceProspeccion[])[0] ?? null;
    setA(yo);
    return yo;
  }, []);

  useEffect(() => {
    void revisar().then((yo) => {
      if (!yo || yo.meta_diaria <= 0 || (yo.faltan <= 0 && yo.hoy >= yo.meta_hoy)) return;
      const llave = `esc-meta-prospeccion-${new Date().toLocaleDateString("en-CA")}`;
      try {
        if (localStorage.getItem(llave)) return;
        localStorage.setItem(llave, "1");
      } catch {
        // sin almacenamiento: se muestra igual
      }
      setPopup(true);
    });
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === "bitacora") void revisar();
    };
    window.addEventListener(EVENTO_CAMBIO, on);
    return () => window.removeEventListener(EVENTO_CAMBIO, on);
  }, [revisar]);

  if (!a || a.meta_diaria <= 0) return null;
  const faltaHoy = Math.max(a.meta_hoy - a.hoy, 0);
  return (
    <>
      {a.faltan > 0 && (
        <Link
          href={DESTINO}
          className="mx-auto mt-3 flex max-w-6xl items-center justify-between gap-3 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm sm:mx-4 lg:mx-auto"
        >
          <span>
            🎯 Te faltan <b>{a.faltan}</b> prospecto(s) por registrar · meta {a.meta_diaria} diarios de lunes a viernes desde el {fechaCorta(a.inicio)}
            {a.meta_hoy ? ` · hoy llevas ${a.hoy} de ${a.meta_hoy}` : ""}
          </span>
          {!pathname.startsWith(DESTINO) && <span className="shrink-0 underline">Registrar</span>}
        </Link>
      )}
      {popup && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="toast-in w-full max-w-md space-y-4 rounded-2xl bg-white p-6 text-center shadow-2xl">
            <p className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-3xl">🎯</p>
            <h2 className="text-lg font-bold text-slate-900">Tu meta de prospección</h2>
            <p className="text-sm text-slate-600">
              Tu meta es de <b>{a.meta_diaria} prospectos nuevos al día</b> (lunes a viernes).
              {a.meta_hoy ? <> Hoy llevas <b>{a.hoy}</b>{faltaHoy ? <>, te faltan <b>{faltaHoy}</b></> : ", ya cumpliste la de hoy"}.</> : null}
            </p>
            {a.faltan > 0 && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                En total te faltan <b>{a.faltan}</b> desde el {fechaCorta(a.inicio)}: llevas {a.registrados} de {a.requeridos}.
              </p>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <Link href={DESTINO} onClick={() => setPopup(false)} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">Registrar prospectos</Link>
              <button type="button" onClick={() => setPopup(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Después</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
