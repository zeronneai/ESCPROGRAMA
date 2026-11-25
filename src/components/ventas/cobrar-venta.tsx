"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { cobrarConComisionAction, lineasCobroAction } from "@/actions/ventas";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import { TcPago } from "@/components/ventas/tc-pago";
import { ComisionEditor, completa, filaDe, payloadDe, type FilaCom } from "@/components/ventas/comision-editor";

/**
 * Marcar cobrada en el mismo lugar: fecha de pago y comision de cada articulo
 * ((importe sin IVA - envio incluido) x %).
 */
export function CobrarVenta({ ventaId, fechaVenta, today, moneda, onClose }: { ventaId: string; fechaVenta: string; today: string; moneda: string; onClose: () => void }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [fecha, setFecha] = useState("");
  const [tc, setTc] = useState("");
  const usd = moneda === "USD";
  const tcOk = !usd || (Number(tc) >= 5 && Number(tc) <= 60);
  const [filas, setFilas] = useState<FilaCom[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    lineasCobroAction(ventaId).then((r) => {
      if (!vivo) return;
      if (!r.ok) return setError(r.error);
      setFilas(r.lineas.map(filaDe));
    });
    return () => { vivo = false; };
  }, [ventaId]);

  const completos = !!filas && filas.every(completa);
  const guardar = () =>
    start(async () => {
      const r = await cobrarConComisionAction(ventaId, fecha, (filas ?? []).map(payloadDe), usd ? Number(tc) : null);
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
      {usd && <TcPago fecha={fecha} valor={tc} setValor={setTc} />}
      {error && <p className="text-red-700">{error}</p>}
      {!filas && !error && (
        <p className="flex items-center gap-2 text-slate-600">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
          Cargando artículos...
        </p>
      )}
      {filas && filas.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-700">Comisión de cada artículo *</p>
          <ComisionEditor filas={filas} setFilas={setFilas} moneda={moneda} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={guardar} loading={pend} disabled={!fecha || !filas || !completos || !tcOk}>Marcar pagada</Button>
        {filas && !completos && <span className="text-xs text-amber-800">Falta el importe o el % de algún artículo.</span>}
        {!fecha && <span className="text-xs text-amber-800">Falta la fecha de pago.</span>}
        {fecha && !tcOk && <span className="text-xs text-amber-800">Falta el tipo de cambio del pago.</span>}
      </div>
    </div>
  );
}
