"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { articuloEscAction, marcarPedidoPegatronAction } from "@/actions/pegatron";

export type LineaPeg = {
  id: string; item: string | null; numero_parte: string | null; descripcion: string; cantidad: number | string; unidad: string | null;
  entrega: string | null; articulo_esc: string; pedido_at: string | null; pedido_nombre: string | null;
};

const fmt = (n: number | string) => Number(n).toLocaleString("es-MX", { maximumFractionDigits: 3 });
const fecha = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

/** Renglones de la OC: el comprador marca pedido; la jefa corrige el articulo ESC mientras no este pedido. */
export function LineasPegatron({ lineas, rol }: { lineas: LineaPeg[]; rol: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id: string; v: string } | null>(null);
  const comprador = rol === "comprador";
  const jefa = rol === "jefe_ventas";

  async function marcar(l: LineaPeg) {
    setBusy(l.id);
    setError(null);
    const r = await marcarPedidoPegatronAction(l.id, !l.pedido_at);
    setBusy(null);
    if (!r.ok) setError(r.error);
    else router.refresh();
  }
  async function guardarArticulo() {
    if (!editando) return;
    setBusy(editando.id);
    const r = await articuloEscAction(editando.id, editando.v);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setEditando(null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {lineas.map((l, i) => {
        const pedido = !!l.pedido_at;
        return (
          <div key={l.id} className={`rounded-xl border p-4 shadow-sm ${pedido ? "border-green-300 bg-green-50" : "border-slate-200 bg-white"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Renglón {l.item || i + 1}{l.numero_parte ? ` · Parte ${l.numero_parte}` : ""}</p>
                {editando?.id === l.id ? (
                  <div className="flex flex-wrap gap-2">
                    <input value={editando.v} onChange={(e) => setEditando({ id: l.id, v: e.target.value })} maxLength={200}
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
                    <button type="button" onClick={guardarArticulo} disabled={busy === l.id} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white">Guardar</button>
                    <button type="button" onClick={() => setEditando(null)} className="px-2 text-sm text-slate-500">Cancelar</button>
                  </div>
                ) : (
                  <p className="text-base font-semibold text-slate-900">
                    {l.articulo_esc}
                    {jefa && !pedido && (
                      <button type="button" onClick={() => setEditando({ id: l.id, v: l.articulo_esc })} className="ml-2 text-xs font-normal text-brand-700 hover:underline">Cambiar</button>
                    )}
                  </p>
                )}
                <p className="text-sm text-slate-600"><span className="text-xs text-slate-500">Pegatron: </span>{l.descripcion}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-900">{fmt(l.cantidad)}<span className="ml-1 text-sm font-medium text-slate-500">{l.unidad ?? ""}</span></p>
                {l.entrega && <p className="text-xs text-slate-500">Entrega {fecha(l.entrega)}</p>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className={`text-sm font-medium ${pedido ? "text-green-800" : "text-amber-800"}`}>
                {pedido ? `✓ Pedido ${fecha(l.pedido_at)}${l.pedido_nombre ? ` por ${l.pedido_nombre}` : ""}` : "Por pedir"}
              </span>
              {comprador && (
                <button type="button" disabled={busy === l.id} onClick={() => void marcar(l)}
                  className={`rounded-md px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${pedido ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : "bg-green-600 text-white hover:bg-green-700"}`}>
                  {busy === l.id ? "Guardando..." : pedido ? "Quitar pedido" : "Marcar como pedido"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
