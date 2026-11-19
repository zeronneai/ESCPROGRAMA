"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { tipoPegatronAction } from "@/actions/pegatron";
import { toast } from "@/components/feedback-global";

/** Seccion de la OC (de linea / sobrepedido). La jefa la puede cambiar. */
export function TipoPegatron({ id, tipo, editable }: { id: string; tipo: "linea" | "sobrepedido"; editable: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const cambiar = (t: "linea" | "sobrepedido") =>
    start(async () => {
      const r = await tipoPegatronAction(id, t);
      if (!r.ok) return toast(r.error, "error");
      toast(`La orden quedó en ${t === "linea" ? "De línea" : "Sobrepedido"}`, "success");
      router.refresh();
    });
  const etiqueta = (t: "linea" | "sobrepedido") => (t === "linea" ? "DE LÍNEA" : "SOBREPEDIDO");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-lg px-3 py-1 text-sm font-extrabold tracking-wide text-white ${tipo === "linea" ? "bg-brand-600" : "bg-orange-500"}`}>{etiqueta(tipo)}</span>
      {editable && (
        <button type="button" disabled={pend} onClick={() => cambiar(tipo === "linea" ? "sobrepedido" : "linea")} className="text-sm text-brand-700 underline disabled:opacity-50">
          Cambiar a {tipo === "linea" ? "Sobrepedido" : "De línea"}
        </button>
      )}
    </div>
  );
}
