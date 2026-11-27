"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EVENTO_CAMBIO } from "@/components/realtime-sync";
import { cuentaTxt, HORA_LIMITE, type CuentaHoy } from "@/lib/estados-cuenta-diarios";
import { createClient } from "@/lib/supabase/client";

const horaLocal = () => Number(new Date().toLocaleString("en-US", { timeZone: "America/Chihuahua", hour: "numeric", hour12: false }));

/** Auxiliar de finanzas: barra roja con los estados de cuenta que faltan subir hoy (lunes a viernes, antes de las 9). */
export function AvisoEstadosCuenta() {
  const pathname = usePathname();
  const [faltan, setFaltan] = useState<CuentaHoy[]>([]);
  const revisar = useCallback(async () => {
    const { data, error } = await createClient().rpc("estados_cuenta_hoy");
    if (error) return;
    const l = (data ?? []) as CuentaHoy[];
    setFaltan(l.length && l[0].habil ? l.filter((c) => !c.subido) : []);
  }, []);
  useEffect(() => {
    void revisar();
  }, [revisar, pathname]);
  useEffect(() => {
    const f = (e: Event) => {
      const t = (e as CustomEvent).detail;
      if (!t || t === "conciliaciones" || t === "conciliacion_movimientos") void revisar();
    };
    window.addEventListener(EVENTO_CAMBIO, f);
    const iv = window.setInterval(() => void revisar(), 5 * 60_000);
    return () => {
      window.removeEventListener(EVENTO_CAMBIO, f);
      window.clearInterval(iv);
    };
  }, [revisar]);
  if (!faltan.length) return null;
  const tarde = horaLocal() >= HORA_LIMITE;
  return (
    <div className="sticky top-0 z-40 bg-red-600 px-4 py-2 text-sm text-white shadow">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <p className="min-w-0">
          <b>{tarde ? `Ya pasaron las ${HORA_LIMITE} am: ` : `Antes de las ${HORA_LIMITE} am: `}</b>
          {faltan.length === 1 ? "falta subir el estado de cuenta de " : `faltan ${faltan.length} estados de cuenta de hoy: `}
          {faltan.map((c) => cuentaTxt(c)).join(", ")}
        </p>
        {!pathname.startsWith("/finanzas/conciliaciones") && (
          <Link href="/finanzas/conciliaciones" className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">Subir ahora</Link>
        )}
      </div>
    </div>
  );
}
