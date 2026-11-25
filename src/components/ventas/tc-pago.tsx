"use client";

import { useEffect, useRef, useState } from "react";
import { tipoCambioDiaAction } from "@/actions/ventas";

/**
 * Venta en dolares: tipo de cambio del dia en que pagaron. Propone el de Banxico de esa fecha;
 * el vendedor lo puede cambiar por el que le aplico su banco.
 */
export function TcPago({ fecha, valor, setValor, monto, disabled }: { fecha: string; valor: string; setValor: (v: string) => void; monto?: number | null; disabled?: boolean }) {
  const [sugerido, setSugerido] = useState<number | null>(null);
  const escrito = useRef(!!valor);
  useEffect(() => {
    if (!fecha) return;
    let vivo = true;
    tipoCambioDiaAction(fecha).then((tc) => {
      if (!vivo) return;
      setSugerido(tc);
      if (tc && (!valor || !escrito.current)) setValor(String(tc));
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);
  const tc = Number(valor);
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-700">
      Tipo de cambio del día del pago *
      <input
        value={valor}
        disabled={disabled}
        inputMode="decimal"
        placeholder="Ej. 18.25"
        onChange={(e) => { escrito.current = true; setValor(e.target.value.replace(/[^\d.]/g, "")); }}
        className={`w-24 rounded border px-2 py-1 text-sm ${tc >= 5 && tc <= 60 ? "border-slate-300" : "border-amber-400 bg-amber-50"}`}
      />
      <span className="font-normal text-slate-500">
        {sugerido ? `Banxico de ese día: ${sugerido}. Si tu banco te dio otro, cámbialo.` : fecha ? "Escribe el que te aplicaron." : "Primero pon la fecha de pago."}
        {monto && tc >= 5 ? ` Se pagaron aprox. $${Math.round(monto * tc).toLocaleString("es-MX")} MXN.` : ""}
      </span>
    </label>
  );
}
