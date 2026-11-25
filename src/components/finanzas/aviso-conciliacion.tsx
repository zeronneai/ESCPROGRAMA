"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EVENTO_CAMBIO } from "@/components/realtime-sync";
import { createClient } from "@/lib/supabase/client";

const VIGENCIA_MS = 7 * 24 * 3600_000;

/**
 * Conciliaciones: cuando finanzas sube un estado de cuenta, en tiempo real sale una ventana
 * "Hay pagos por identificar". Despues queda un aviso fijo arriba mientras haya pagos sin identificar
 * (en rojo si ya pasaron los 7 dias).
 */
export function AvisoConciliacion({ destino }: { destino: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [libres, setLibres] = useState(0);
  const [vencidos, setVencidos] = useState(0);
  const [popup, setPopup] = useState<{ id: string; texto: string } | null>(null);

  const revisar = useCallback(async () => {
    const sb = createClient();
    const [{ data: movs, error }, { data: notis }] = await Promise.all([
      sb.from("conciliacion_movimientos").select("created_at").is("tomado_por", null).limit(5000),
      sb.from("notifications").select("id, cuerpo").eq("tipo", "conciliacion").is("read_at", null).order("created_at", { ascending: false }).limit(1),
    ]);
    if (error) return;
    const ahora = Date.now();
    setLibres((movs ?? []).length);
    setVencidos((movs ?? []).filter((m) => ahora - new Date(m.created_at as string).getTime() > VIGENCIA_MS).length);
    const n = notis?.[0];
    if (n) setPopup({ id: n.id as string, texto: (n.cuerpo as string) ?? "" });
  }, []);

  useEffect(() => {
    void revisar();
    const on = (e: Event) => {
      const t = (e as CustomEvent<string>).detail;
      if (t === "notifications" || t === "conciliacion_movimientos") void revisar();
    };
    window.addEventListener(EVENTO_CAMBIO, on);
    return () => window.removeEventListener(EVENTO_CAMBIO, on);
  }, [revisar]);

  const cerrar = async (ir: boolean) => {
    const id = popup?.id;
    setPopup(null);
    if (id) await createClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("tipo", "conciliacion").is("read_at", null);
    if (ir) router.push(destino);
  };

  return (
    <>
      {libres > 0 && !pathname.startsWith(destino) && (
        <Link
          href={destino}
          className={`mx-auto mt-3 flex max-w-6xl items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm font-medium shadow-sm sm:mx-4 lg:mx-auto ${vencidos ? "bg-red-600 text-white" : "bg-amber-100 text-amber-950 ring-1 ring-amber-300"}`}
        >
          <span>
            💰 Hay {libres} pago(s) pendiente(s) de identificar en Conciliaciones
            {vencidos ? ` · ${vencidos} ya pasaron los 7 días (comisión −10%)` : ""}
          </span>
          <span className="shrink-0 underline">Revisar</span>
        </Link>
      )}
      {popup && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="toast-in w-full max-w-md space-y-4 rounded-2xl bg-white p-6 text-center shadow-2xl">
            <p className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-3xl">💰</p>
            <h2 className="text-lg font-bold text-slate-900">Hay pagos por identificar</h2>
            <p className="text-sm text-slate-600">{popup.texto || "Finanzas subió un estado de cuenta nuevo."}</p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Tienes <b>7 días</b> para identificar tus pagos. Si se identifican después, la comisión baja 10% y se paga hasta la siguiente quincena.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => cerrar(true)} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">Ver pagos</button>
              <button type="button" onClick={() => cerrar(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Después</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
