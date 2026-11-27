"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { tipoTxt, type AlertaIncidencia } from "@/lib/incidencias";
import { MESES_LARGOS } from "@/lib/rrhh";
import { createClient } from "@/lib/supabase/client";

/** Coordinador ISO: ventana cuando se juntan 3 de la misma incidencia en un mes y falta su accion correctiva (RAC). */
export function AvisoIncidenciasIso() {
  const pathname = usePathname();
  const [alertas, setAlertas] = useState<AlertaIncidencia[]>([]);
  const [cerrado, setCerrado] = useState(false);

  useEffect(() => {
    void createClient()
      .from("incidencias_alertas")
      .select("id, tipo, mes, n, sac_id")
      .is("sac_id", null)
      .order("mes", { ascending: false })
      .then(({ data, error }) => {
        if (error) return;
        const l = (data ?? []) as AlertaIncidencia[];
        setAlertas(l);
        // "Despues" la esconde en esta sesion; vuelve a salir hasta que se llene la RAC.
        try {
          if (l.length && sessionStorage.getItem(`esc-inc-rac-${l.map((a) => `${a.id}:${a.n}`).join(",")}`)) setCerrado(true);
        } catch {
          // sin almacenamiento: se muestra igual
        }
      });
  }, [pathname]);

  if (!alertas.length || cerrado || pathname.startsWith("/calidad/sac/nueva")) return null;
  const despues = () => {
    try {
      sessionStorage.setItem(`esc-inc-rac-${alertas.map((a) => `${a.id}:${a.n}`).join(",")}`, "1");
    } catch {
      // nada
    }
    setCerrado(true);
  };
  const mesTxt = (d: string) => `${MESES_LARGOS[Number(d.slice(5, 7)) - 1].toLowerCase()} ${d.slice(0, 4)}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Bitácora de incidencias</p>
          <h2 className="mt-1 text-lg font-bold">Se registró la tercera incidencia del mes</h2>
          <p className="mt-1 text-sm text-slate-600">Cuando una misma incidencia se repite 3 veces en un mes hay que llenar una acción correctiva (RAC).</p>
        </div>
        <ul className="space-y-2">
          {alertas.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
              <span><b>{tipoTxt(a.tipo)}</b><br /><span className="text-xs text-red-800">{a.n} en {mesTxt(a.mes)}</span></span>
              <Link href={`/calidad/sac/nueva?alerta=${a.id}`} onClick={() => setCerrado(true)} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">Llenar RAC</Link>
            </li>
          ))}
        </ul>
        <div className="flex justify-between gap-2">
          <Link href="/incidencias" onClick={() => setCerrado(true)} className="text-sm font-medium text-brand-700 underline">Ver bitácora</Link>
          <button type="button" onClick={despues} className="text-sm text-slate-500 underline">Después</button>
        </div>
      </div>
    </div>
  );
}
