"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelarIncidenciaAction, guardarIncidenciaAction } from "@/actions/incidencias";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import { INCIDENCIA_TIPOS, INCIDENCIA_VARIANTES, type Incidencia, type IncidenciaTipo, type IncidenciaVariante } from "@/lib/incidencias";

const inp = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";
const lbl = "mb-1 block text-xs font-medium text-slate-600";

/** Captura de una incidencia: el supervisor elige una de las 5 del formato; lo demas es abierto. La firma es automatica. */
export function IncidenciaForm({ hoy, firma, inicial, onListo }: { hoy: string; firma: string; inicial?: Incidencia; onListo?: () => void }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [fecha, setFecha] = useState(inicial?.fecha ?? hoy);
  const [tipo, setTipo] = useState<IncidenciaTipo | "">(inicial?.tipo ?? "");
  const [variante, setVariante] = useState<IncidenciaVariante | "">(inicial?.variante ?? "");
  const [producto, setProducto] = useState(inicial?.producto ?? "");
  const [cliente, setCliente] = useState(inicial?.cliente ?? "");
  const [factura, setFactura] = useState(inicial?.factura ?? "");
  const [accion, setAccion] = useState(inicial?.accion ?? "");

  const guardar = () => {
    if (!tipo) return toast("Elige la incidencia.", "error");
    if (tipo === "producto_no_conforme" && !variante) return toast("Elige dónde se dañó el producto.", "error");
    start(async () => {
      const r = await guardarIncidenciaAction(inicial?.id ?? null, {
        fecha, tipo, variante: tipo === "producto_no_conforme" ? (variante as IncidenciaVariante) : null,
        producto: producto.trim() || null, cliente: cliente.trim() || null, factura: factura.trim() || null, accion: accion.trim() || null,
      });
      if (!r.ok) return toast(r.error, "error");
      toast(inicial ? "Incidencia corregida." : "Incidencia registrada.", "success");
      if (!inicial) { setTipo(""); setVariante(""); setProducto(""); setCliente(""); setFactura(""); setAccion(""); setFecha(hoy); }
      onListo?.();
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <span className={lbl}>Incidencia</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(INCIDENCIA_TIPOS) as IncidenciaTipo[]).map((k) => {
            const t = INCIDENCIA_TIPOS[k];
            const on = tipo === k;
            return (
              <button key={k} type="button" onClick={() => setTipo(k)} className={`rounded-lg border p-2.5 text-left text-sm ${on ? "border-brand-500 bg-brand-50 ring-2 ring-brand-200" : "border-slate-300 bg-white hover:border-brand-300"}`}>
                <span className="font-semibold">{t.n}. {t.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{t.desc}</span>
              </button>
            );
          })}
        </div>
        {tipo === "producto_no_conforme" && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">Dañado en:</span>
            {(Object.keys(INCIDENCIA_VARIANTES) as IncidenciaVariante[]).map((v) => (
              <button key={v} type="button" onClick={() => setVariante(v)} className={`rounded-full border px-3 py-1 text-sm ${variante === v ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                {INCIDENCIA_VARIANTES[v]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className={lbl}>Fecha</span>
          <input type="date" className={inp} value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label className="block sm:col-span-1 lg:col-span-2">
          <span className={lbl}>Producto / Código / Cantidad</span>
          <input className={inp} value={producto} maxLength={500} onChange={(e) => setProducto(e.target.value)} placeholder="Ej. ESC-GN100 guante nitrilo M · 10 cajas" />
        </label>
        <label className="block">
          <span className={lbl}>Factura</span>
          <input className={inp} value={factura} maxLength={80} onChange={(e) => setFactura(e.target.value)} placeholder="Ej. FD2595" />
        </label>
        <label className="block sm:col-span-2">
          <span className={lbl}>Cliente / Etapa</span>
          <input className={inp} value={cliente} maxLength={300} onChange={(e) => setCliente(e.target.value)} placeholder="Ej. Pegatron · en la entrega" />
        </label>
        <label className="block sm:col-span-2">
          <span className={lbl}>Acción</span>
          <textarea className={inp} rows={2} value={accion} maxLength={2000} onChange={(e) => setAccion(e.target.value)} placeholder="Qué se hizo para corregirlo" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={guardar} loading={pend}>{inicial ? "Guardar cambios" : "Registrar incidencia"}</Button>
        <span className="text-xs text-slate-500">Firma: <b>{inicial?.firma_nombre ?? firma}</b> (automática)</span>
      </div>
    </div>
  );
}

export function EditarIncidencia({ inc, hoy }: { inc: Incidencia; hoy: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [pend, start] = useTransition();
  const [seguro, setSeguro] = useState(false);
  if (!abierto) {
    return (
      <span className="flex gap-3 text-xs">
        <button type="button" className="font-medium text-brand-700 underline" onClick={() => setAbierto(true)}>Corregir</button>
        {seguro ? (
          <>
            <button type="button" disabled={pend} className="font-semibold text-red-600 underline" onClick={() => start(async () => { const r = await cancelarIncidenciaAction(inc.id); if (!r.ok) return toast(r.error, "error"); toast("Incidencia cancelada.", "success"); router.refresh(); })}>Sí, cancelar</button>
            <button type="button" className="text-slate-500 underline" onClick={() => setSeguro(false)}>No</button>
          </>
        ) : (
          <button type="button" className="text-slate-500 underline hover:text-red-600" onClick={() => setSeguro(true)}>Cancelar</button>
        )}
      </span>
    );
  }
  return (
    <div className="mt-2 w-full rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <IncidenciaForm hoy={hoy} firma="" inicial={inc} onListo={() => setAbierto(false)} />
      <button type="button" className="mt-2 text-xs text-slate-500 underline" onClick={() => setAbierto(false)}>Cerrar</button>
    </div>
  );
}
