"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelarCapturaAction, capturarVentaMetaAction } from "@/actions/meta-prospeccion";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";

/** Formulario para capturar a mano una venta (sin IVA) de una meta sin usuario. */
export function CapturarVenta({ metas, hoy }: { metas: { id: string; nombre: string }[]; hoy: string }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [meta, setMeta] = useState(metas[0]?.id ?? "");
  const [fecha, setFecha] = useState(hoy);
  const [folio, setFolio] = useState("");
  const [cliente, setCliente] = useState("");
  const [sub, setSub] = useState("");
  const [moneda, setMoneda] = useState<"MXN" | "USD">("MXN");
  const [tc, setTc] = useState("");
  const [nota, setNota] = useState("");
  const inp = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
  const guardar = () =>
    start(async () => {
      const r = await capturarVentaMetaAction({
        meta_id: meta, fecha, folio: folio || null, cliente: cliente || null, subtotal: Number(sub.replace(/[,$\s]/g, "")), moneda,
        tipo_cambio: moneda === "USD" && Number(tc) > 0 ? Number(tc) : null, nota: nota || null,
      });
      if (!r.ok) return toast(r.error, "error");
      toast("Venta capturada: ya suma en las gráficas", "success");
      setFolio(""); setCliente(""); setSub(""); setTc(""); setNota("");
      router.refresh();
    });
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        {metas.length > 1 && (
          <label className="text-sm font-medium text-slate-700">Meta de
            <select className={inp} value={meta} onChange={(e) => setMeta(e.target.value)}>{metas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
          </label>
        )}
        <label className="text-sm font-medium text-slate-700">Fecha de la factura<input type="date" className={inp} value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label className="text-sm font-medium text-slate-700">Folio de factura<input className={inp} value={folio} onChange={(e) => setFolio(e.target.value)} maxLength={60} placeholder="Opcional" /></label>
        <label className="text-sm font-medium text-slate-700">Cliente<input className={inp} value={cliente} onChange={(e) => setCliente(e.target.value)} maxLength={200} placeholder="Opcional" /></label>
        <label className="text-sm font-medium text-slate-700">Importe SIN IVA *<input className={`${inp} tabular-nums`} inputMode="decimal" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Subtotal de la factura" /></label>
        <label className="text-sm font-medium text-slate-700">Moneda
          <select className={inp} value={moneda} onChange={(e) => setMoneda(e.target.value as "MXN" | "USD")}><option value="MXN">MXN</option><option value="USD">USD</option></select>
        </label>
        {moneda === "USD" && <label className="text-sm font-medium text-slate-700">Tipo de cambio<input className={inp} inputMode="decimal" value={tc} onChange={(e) => setTc(e.target.value)} placeholder="Vacío = el del día (Banxico)" /></label>}
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Nota<input className={inp} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} placeholder="Opcional" /></label>
      </div>
      <Button type="button" onClick={guardar} loading={pend} disabled={!meta || !(Number(sub.replace(/[,$\s]/g, "")) > 0)}>Capturar venta</Button>
    </div>
  );
}

export function CancelarCaptura({ id }: { id: string }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  return (
    <button type="button" disabled={pend} className="text-xs font-medium text-red-700 underline disabled:opacity-50" onClick={() => start(async () => {
      if (!window.confirm("¿Cancelar esta venta capturada? Deja de sumar en la meta.")) return;
      const r = await cancelarCapturaAction(id);
      if (!r.ok) return toast(r.error, "error");
      router.refresh();
    })}>{pend ? "Cancelando…" : "Cancelar"}</button>
  );
}
