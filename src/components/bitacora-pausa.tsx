"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { pausaBitacoraAction } from "@/actions/bitacora";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";

const MOTIVOS = ["Varios intentos sin respuesta", "El cliente pidió buscarlo más adelante", "Sin presupuesto por ahora", "Ya tiene proveedor por el momento"];

/** Boton de pausa del prospecto: mientras esta en pausa no corre el seguimiento ni cuenta como atrasado. */
export function PausaProspecto({ id, pausadaAt, motivo, puede }: { id: string; pausadaAt: string | null; motivo: string | null; puede: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [m, setM] = useState("");
  const correr = (pausar: boolean) =>
    start(async () => {
      const r = await pausaBitacoraAction(id, pausar, m);
      if (!r.ok) return toast(r.error, "error");
      toast(pausar ? "Prospecto en pausa: ya no corre el seguimiento." : "Seguimiento reanudado.", "success");
      setAbierto(false);
      router.refresh();
    });

  if (pausadaAt) {
    const desde = new Date(pausadaAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-slate-400 bg-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-extrabold tracking-wide text-slate-800">⏸ EN PAUSA desde el {desde}</p>
          <p className="text-xs text-slate-600">{motivo ? `Motivo: ${motivo}. ` : ""}No corre el seguimiento ni cuenta como atrasado.</p>
        </div>
        {puede && <Button type="button" onClick={() => correr(false)} loading={pend}>▶ Reanudar seguimiento</Button>}
      </div>
    );
  }
  if (!puede) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      {!abierto ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">¿Ya le diste seguimiento varias veces y no avanza? Ponlo en pausa para que no corra el tiempo.</p>
          <Button type="button" variant="secondary" onClick={() => setAbierto(true)}>⏸ Poner en pausa</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800">¿Por qué lo pones en pausa? (opcional)</p>
          <div className="flex flex-wrap gap-2">
            {MOTIVOS.map((x) => (
              <button key={x} type="button" onClick={() => setM(x)} className={`rounded-full border px-3 py-1 text-xs ${m === x ? "border-slate-700 bg-slate-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"}`}>{x}</button>
            ))}
          </div>
          <input value={m} onChange={(e) => setM(e.target.value)} maxLength={300} placeholder="O escribe el motivo" aria-label="Motivo de la pausa" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => correr(true)} loading={pend}>Poner en pausa</Button>
            <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
