"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { guardarPeriodoMetasAction, nuevoLinkMetasAction } from "@/actions/meta-prospeccion";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";

/** Periodo que cuenta para las metas (proporcional) y link publico para las pantallas. */
export function ConfigPeriodo({ desde, hasta, token, edita }: { desde: string | null; hasta: string | null; token: string; edita: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [d, setD] = useState(desde ?? "");
  const [h, setH] = useState(hasta ?? "");
  const [origen, setOrigen] = useState("");
  useEffect(() => setOrigen(window.location.origin), []);
  const link = `${origen}/pantalla/metas/${token}`;
  const inp = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-800">Periodo que se mide</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="w-44 text-sm text-slate-700">Contar desde<input type="date" className={inp} value={d} onChange={(e) => setD(e.target.value)} disabled={!edita} /></label>
          <label className="w-44 text-sm text-slate-700">Hasta (opcional)<input type="date" className={inp} value={h} onChange={(e) => setH(e.target.value)} disabled={!edita} /></label>
          {edita && (
            <Button type="button" loading={pend} onClick={() => start(async () => {
              const r = await guardarPeriodoMetasAction({ desde: d || null, hasta: h || null });
              if (!r.ok) return toast(r.error, "error");
              toast("Periodo guardado", "success");
              router.refresh();
            })}>Guardar periodo</Button>
          )}
        </div>
        <p className="text-xs text-slate-500">
          La meta del mes se ajusta en proporción a los días: del 16 al 30 de noviembre son 15 de 30 días, así que la meta es la mitad.
          Al empezar un mes nuevo se toma solo, completo (del 1 al último día), sin que tengas que cambiar nada.
        </p>
      </div>
      <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
        <p className="text-sm font-semibold text-violet-900">Link para las pantallas (sin usuario)</p>
        <p className="text-xs text-violet-900/80">Ábrelo en la tele y ponlo en pantalla completa. Se actualiza solo en cuanto entra una venta. Solo muestra nombres y porcentajes, nunca montos.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly value={origen ? link : ""} className="min-w-0 flex-1 rounded-md border border-violet-200 bg-white px-3 py-2 text-xs" aria-label="Link de la pantalla" onFocus={(e) => e.target.select()} />
          <Button type="button" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(link); toast("Link copiado", "success"); }}>Copiar</Button>
          <a href={link} target="_blank" rel="noreferrer" className="text-sm font-medium text-violet-800 underline">Abrir</a>
        </div>
        {edita && (
          <button type="button" disabled={pend} className="text-xs text-violet-800 underline" onClick={() => start(async () => {
            if (!window.confirm("¿Hacer un link nuevo? El que está en las pantallas deja de funcionar.")) return;
            const r = await nuevoLinkMetasAction();
            if (!r.ok) return toast(r.error, "error");
            toast("Link nuevo listo: cámbialo en las pantallas", "success");
            router.refresh();
          })}>Cambiar link (si se compartió por error)</button>
        )}
      </div>
    </div>
  );
}
