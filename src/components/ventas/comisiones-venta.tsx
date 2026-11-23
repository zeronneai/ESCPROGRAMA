"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { comisionesVentaAction } from "@/actions/ventas";
import { toast } from "@/components/feedback-global";
import { Button, Card } from "@/components/ui";
import { ComisionEditor, comisionDe, filaDe, payloadDe, type FilaCom } from "@/components/ventas/comision-editor";
import { money2 as money, type VentaLinea } from "@/lib/ventas";

/**
 * Comision por articulo de una venta: (importe sin IVA - envio incluido) x %.
 * Obligatoria para marcar la venta pagada. Pagada: el vendedor solo llena lo que falta; la jefa siempre.
 */
export function ComisionesVenta({ ventaId, lineas, moneda, editable, pagada, resaltar, jefa = false }: { ventaId: string; lineas: VentaLinea[]; moneda: string; editable: boolean; pagada: boolean; resaltar?: boolean; jefa?: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const ini = lineas.filter((l) => l.id).map((l) => filaDe({ ...l, id: l.id! }));
  const [filas, setFilas] = useState<FilaCom[]>(ini);
  if (!filas.length) return null;
  const faltan = filas.filter((x) => x.imp === "" || x.pct === "").length;
  const cambio = filas.some((x, i) => x.imp !== ini[i].imp || x.pct !== ini[i].pct || x.env !== ini[i].env);
  const puede = (i: number, c: "imp" | "env" | "pct") => editable && (jefa || !pagada || ini[i][c] === "");
  const total = filas.reduce((a, f) => a + (comisionDe(f) ?? 0), 0);
  const guardar = () =>
    start(async () => {
      const r = await comisionesVentaAction(ventaId, filas.map(payloadDe));
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
            (Importe sin IVA − envío incluido) × % = comisión. {pagada ? "Ya está pagada: el vendedor solo puede llenar lo que falta; para corregir, la jefa de ventas." : "Es obligatoria para marcar la venta como pagada."}
          </p>
        </div>
        <p className="text-right">
          <span className="block text-xs text-slate-500">Comisión total</span>
          <span className="text-lg font-bold tabular-nums text-slate-900">{money(total, moneda)}</span>
        </p>
      </div>
      {faltan > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Falta el importe o el % de {faltan} artículo(s).</p>}
      <ComisionEditor filas={filas} setFilas={setFilas} moneda={moneda} puede={puede} />
      {editable && <Button type="button" onClick={guardar} loading={pend} disabled={!cambio}>Guardar comisión</Button>}
    </Card>
  );
}
