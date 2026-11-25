"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { atenderPedidoAction, cancelarPedidoAction, reabrirPedidoAction } from "@/actions/pedidos";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";

/** Comprador: marcar como pedido (con folio o nota) o cancelar con nota para el vendedor. */
export function AtenderPedido({ id, conClave }: { id: string; conClave: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [abierto, setAbierto] = useState<"pedido" | "cancelar" | null>(null);
  const [folio, setFolio] = useState("");
  const [nota, setNota] = useState("");
  const hacer = () =>
    start(async () => {
      const r = abierto === "pedido" ? await atenderPedidoAction(id, folio, nota) : await cancelarPedidoAction(id, nota);
      if (!r.ok) return toast(r.error, "error");
      toast(abierto === "pedido" ? "Marcado como pedido" : "Pedido cancelado", "success");
      setAbierto(null);
      router.refresh();
    });
  if (!abierto)
    return (
      <div className="flex flex-wrap gap-3 text-xs font-medium">
        <button type="button" className="text-brand-700 underline" onClick={() => setAbierto("pedido")} title={conClave ? "Si es única, se marca sola al meter el artículo en una OC" : undefined}>Ya lo pedí</button>
        <button type="button" className="text-red-700 underline" onClick={() => setAbierto("cancelar")}>No se va a pedir</button>
      </div>
    );
  return (
    <div className="flex flex-wrap items-end gap-2">
      {abierto === "pedido" && (
        <input className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm" placeholder="Folio OC" value={folio} onChange={(e) => setFolio(e.target.value)} maxLength={40} />
      )}
      <input className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm" placeholder={abierto === "pedido" ? "Nota para el vendedor (opcional)" : "¿Por qué? (lo ve el vendedor)"} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={1000} />
      <Button type="button" onClick={hacer} loading={pend} variant={abierto === "cancelar" ? "secondary" : undefined}>{abierto === "pedido" ? "Guardar" : "Cancelar pedido"}</Button>
      <button type="button" className="text-xs text-slate-500 underline" onClick={() => setAbierto(null)}>Volver</button>
    </div>
  );
}

export function ReabrirPedido({ id }: { id: string }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  return (
    <button type="button" disabled={pend} className="text-xs text-slate-500 underline" onClick={() => start(async () => {
      const r = await reabrirPedidoAction(id);
      if (!r.ok) return toast(r.error, "error");
      router.refresh();
    })}>Reabrir</button>
  );
}
