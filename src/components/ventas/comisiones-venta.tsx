"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { comisionesVentaAction } from "@/actions/ventas";
import { toast } from "@/components/feedback-global";
import { Button, Card } from "@/components/ui";
import { money2 as money, type VentaLinea } from "@/lib/ventas";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Comision por articulo de una venta: importe (sin IVA) x % = comision.
 * Obligatoria para marcar la venta pagada. El vendedor la edita hasta que se paga; la jefa siempre.
 */
export function ComisionesVenta({ ventaId, lineas, moneda, editable, pagada, resaltar }: { ventaId: string; lineas: VentaLinea[]; moneda: string; editable: boolean; pagada: boolean; resaltar?: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [v, setV] = useState(() => lineas.filter((l) => l.id).map((l) => ({ id: l.id!, desc: l.descripcion, clave: l.clave, cant: l.cantidad, importe: l.importe != null ? String(l.importe) : "", pct: l.comision_pct != null ? String(l.comision_pct) : "" })));
  const [todos, setTodos] = useState("");
  if (!v.length) return null;
  const com = (x: { importe: string; pct: string }) => (x.importe !== "" && x.pct !== "" ? r2((Number(x.importe) * Number(x.pct)) / 100) : null);
  const total = v.reduce((a, x) => a + (com(x) ?? 0), 0);
  const faltan = v.filter((x) => x.importe === "" || x.pct === "").length;
  const cambio = v.some((x, i) => x.importe !== (lineas[i]?.importe != null ? String(lineas[i].importe) : "") || x.pct !== (lineas[i]?.comision_pct != null ? String(lineas[i].comision_pct) : ""));
  const set = (i: number, k: "importe" | "pct", val: string) => setV((s) => s.map((x, j) => (j === i ? { ...x, [k]: val.replace(/[^\d.]/g, "") } : x)));
  const guardar = () =>
    start(async () => {
      const r = await comisionesVentaAction(ventaId, v.map((x) => ({ id: x.id, importe: x.importe === "" ? null : Number(x.importe), comision_pct: x.pct === "" ? null : Number(x.pct) })));
      if (!r.ok) return toast(r.error, "error");
      toast("Comisión guardada", "success");
      router.refresh();
    });

  return (
    <Card id="comision" className={`space-y-3 p-4 ${resaltar || (faltan && !pagada) ? "border-2 border-amber-400" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900">Comisión por artículo</p>
          <p className="text-xs text-slate-500">
            Importe sin IVA × % = comisión. {pagada ? (editable ? "Ya está pagada: solo la jefa de ventas puede cambiarla." : "Ya está pagada.") : "Es obligatoria para marcar la venta como pagada."}
          </p>
        </div>
        <p className="text-right">
          <span className="block text-xs text-slate-500">Comisión total</span>
          <span className="text-lg font-bold tabular-nums text-slate-900">{money(total, moneda)}</span>
        </p>
      </div>
      {faltan > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Falta el {v.length > 1 ? "importe o el %" : "%"} de {faltan} artículo(s).</p>}
      {editable && v.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Mismo % para todos:</span>
          <input value={todos} onChange={(e) => setTodos(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className="w-20 rounded border border-slate-300 px-2 py-1 text-right" placeholder="%" />
          <Button type="button" variant="secondary" className="text-xs" disabled={todos === ""} onClick={() => setV((s) => s.map((x) => ({ ...x, pct: todos })))}>Aplicar</Button>
        </div>
      )}
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {v.map((x, i) => {
          const c = com(x);
          return (
            <div key={x.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium text-slate-900">{x.clave ? <span className="font-mono text-xs text-slate-500">{x.clave} · </span> : null}{x.desc}</p>
                {x.cant != null && <p className="text-xs text-slate-500">{x.cant} pza(s)</p>}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                Importe
                <input value={x.importe} disabled={!editable} onChange={(e) => set(i, "importe", e.target.value)} inputMode="decimal" placeholder="0.00" className={`w-28 rounded border px-2 py-1.5 text-right text-sm ${x.importe === "" ? "border-amber-400 bg-amber-50" : "border-slate-300"}`} />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                %
                <input value={x.pct} disabled={!editable} onChange={(e) => set(i, "pct", e.target.value)} inputMode="decimal" placeholder="0" className={`w-16 rounded border px-2 py-1.5 text-right text-sm ${x.pct === "" ? "border-amber-400 bg-amber-50" : "border-slate-300"}`} />
              </label>
              <span className="w-28 text-right text-sm font-semibold tabular-nums text-slate-800">{c == null ? "-" : money(c, moneda)}</span>
            </div>
          );
        })}
      </div>
      {editable && (
        <Button type="button" onClick={guardar} loading={pend} disabled={!cambio}>Guardar comisión</Button>
      )}
    </Card>
  );
}
