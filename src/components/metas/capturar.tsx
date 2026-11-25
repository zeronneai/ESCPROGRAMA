"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelarCapturaAction, capturarVentaMetaAction } from "@/actions/meta-prospeccion";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";

/** Capturar a mano lo vendido (sin IVA) por alguien sin usuario: solo la cantidad; la fecha es la de hoy. */
export function CapturarVenta({ metas, hoy }: { metas: { id: string; nombre: string }[]; hoy: string }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [meta, setMeta] = useState(metas[0]?.id ?? "");
  const [cant, setCant] = useState("");
  const monto = Number(cant.replace(/[,$\s]/g, ""));
  const guardar = () =>
    start(async () => {
      const r = await capturarVentaMetaAction({ meta_id: meta, fecha: hoy, subtotal: monto, moneda: "MXN" });
      if (!r.ok) return toast(r.error, "error");
      toast("Listo: ya suma en las gráficas", "success");
      setCant("");
      router.refresh();
    });
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        {metas.length > 1 && (
          <label className="text-sm font-medium text-slate-700">Ventas de
            <select className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm" value={meta} onChange={(e) => setMeta(e.target.value)}>{metas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
          </label>
        )}
        <label className="text-sm font-medium text-slate-700">
          Cantidad vendida, en pesos sin IVA
          <input
            className="mt-1 block w-56 rounded-md border border-slate-300 px-3 py-2 text-lg tabular-nums"
            inputMode="decimal"
            value={cant}
            onChange={(e) => setCant(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && monto > 0) guardar(); }}
            placeholder="0.00"
          />
        </label>
        <Button type="button" onClick={guardar} loading={pend} disabled={!meta || !(monto > 0)}>Sumar</Button>
      </div>
      <p className="text-xs text-slate-500">Se suma con la fecha de hoy. Si te equivocas, cancélala abajo y vuelve a ponerla.</p>
    </div>
  );
}

export function CancelarCaptura({ id }: { id: string }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  return (
    <button type="button" disabled={pend} className="text-xs font-medium text-red-700 underline disabled:opacity-50" onClick={() => start(async () => {
      if (!window.confirm("¿Cancelar esta cantidad? Deja de sumar en la meta.")) return;
      const r = await cancelarCapturaAction(id);
      if (!r.ok) return toast(r.error, "error");
      router.refresh();
    })}>{pend ? "Cancelando…" : "Cancelar"}</button>
  );
}
