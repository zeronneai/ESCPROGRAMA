"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { cobrarConComisionAction, lineasCobroAction, type LineaCobro } from "@/actions/ventas";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import { money2 } from "@/lib/ventas";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Marcar cobrada en el mismo lugar: fecha de pago y comision de cada articulo (importe sin IVA x %).
 * Lo que ya tiene valor se muestra y solo se piden los que faltan (la venta aun no esta pagada, asi que se pueden corregir).
 */
export function CobrarVenta({ ventaId, fechaVenta, today, moneda, onClose }: { ventaId: string; fechaVenta: string; today: string; moneda: string; onClose: () => void }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [fecha, setFecha] = useState("");
  const [lineas, setLineas] = useState<(LineaCobro & { imp: string; pct: string })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [todos, setTodos] = useState("");

  useEffect(() => {
    let vivo = true;
    lineasCobroAction(ventaId).then((r) => {
      if (!vivo) return;
      if (!r.ok) return setError(r.error);
      setLineas(r.lineas.map((l) => ({ ...l, imp: l.importe != null ? String(l.importe) : "", pct: l.comision_pct != null ? String(l.comision_pct) : "" })));
    });
    return () => { vivo = false; };
  }, [ventaId]);

  const set = (i: number, k: "imp" | "pct", v: string) => setLineas((s) => s!.map((x, j) => (j === i ? { ...x, [k]: v.replace(/[^\d.]/g, "") } : x)));
  const completos = !!lineas && lineas.every((l) => l.imp !== "" && l.pct !== "");
  const total = (lineas ?? []).reduce((a, l) => a + (l.imp !== "" && l.pct !== "" ? r2((Number(l.imp) * Number(l.pct)) / 100) : 0), 0);
  const guardar = () =>
    start(async () => {
      const r = await cobrarConComisionAction(ventaId, fecha, (lineas ?? []).map((l) => ({ id: l.id, importe: Number(l.imp), comision_pct: Number(l.pct) })));
      if (!r.ok) return toast(r.error, "error");
      toast("Venta marcada como pagada con su comisión", "success");
      onClose();
      router.refresh();
    });

  return (
    <div className="mt-2 w-full space-y-3 rounded-xl border-2 border-green-600 bg-green-50/60 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-green-950">Marcar pagada</p>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:underline">Cancelar</button>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-700">
        ¿Cuándo te pagaron? *
        <input type="date" value={fecha} max={today} min={fechaVenta} onChange={(e) => setFecha(e.target.value)} className={`rounded border px-2 py-1 text-sm ${fecha ? "border-slate-300" : "border-amber-400 bg-amber-50"}`} />
      </label>
      {error && <p className="text-red-700">{error}</p>}
      {!lineas && !error && <p className="text-slate-500">Cargando artículos...</p>}
      {lineas && lineas.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-700">Comisión de cada artículo (importe sin IVA × %) *</p>
            {lineas.length > 1 && (
              <span className="flex items-center gap-1.5 text-xs text-slate-600">
                Mismo % para todos
                <input value={todos} onChange={(e) => setTodos(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="%" className="w-14 rounded border border-slate-300 px-2 py-1 text-right" />
                <button type="button" disabled={todos === ""} onClick={() => setLineas((s) => s!.map((x) => ({ ...x, pct: todos })))} className="rounded border border-slate-300 bg-white px-2 py-1 disabled:opacity-50">Aplicar</button>
              </span>
            )}
          </div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {lineas.map((l, i) => {
              const c = l.imp !== "" && l.pct !== "" ? r2((Number(l.imp) * Number(l.pct)) / 100) : null;
              return (
                <div key={l.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
                  <span className="min-w-0 flex-1">
                    {l.clave && <span className="font-mono text-xs text-slate-500">{l.clave} · </span>}
                    {l.descripcion}
                    {l.cantidad != null && <span className="text-xs text-slate-500"> · {l.cantidad} pza(s)</span>}
                  </span>
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    Importe
                    <input value={l.imp} onChange={(e) => set(i, "imp", e.target.value)} inputMode="decimal" placeholder="0.00" className={`w-24 rounded border px-2 py-1 text-right text-sm ${l.imp === "" ? "border-amber-400 bg-amber-50" : "border-slate-300"}`} />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    %
                    <input value={l.pct} onChange={(e) => set(i, "pct", e.target.value)} inputMode="decimal" placeholder="0" className={`w-14 rounded border px-2 py-1 text-right text-sm ${l.pct === "" ? "border-amber-400 bg-amber-50" : "border-slate-300"}`} />
                  </label>
                  <span className="w-24 text-right font-medium tabular-nums">{c == null ? "-" : money2(c, moneda)}</span>
                </div>
              );
            })}
          </div>
          <p className="text-right text-xs text-slate-600">Comisión total: <b className="tabular-nums">{money2(total, moneda)}</b></p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={guardar} loading={pend} disabled={!fecha || !lineas || !completos}>Marcar pagada</Button>
        {lineas && !completos && <span className="text-xs text-amber-800">Falta el importe o el % de algún artículo.</span>}
        {!fecha && <span className="text-xs text-amber-800">Falta la fecha de pago.</span>}
      </div>
    </div>
  );
}
