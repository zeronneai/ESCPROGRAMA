"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { subirConciliacionAction } from "@/actions/conciliaciones";
import { toast } from "@/components/feedback-global";
import { Button, Card } from "@/components/ui";
import type { EstadoCuentaLeido } from "@/lib/estado-cuenta";
import { leerEstadoCuentaPdf } from "@/lib/estado-cuenta-pdf";
import { money2 } from "@/lib/ventas";

const fecha = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Finanzas sube el estado de cuenta: se lee aqui mismo, se revisa y se guardan solo los abonos. */
export function SubirConciliacion() {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [leyendo, setLeyendo] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [leido, setLeido] = useState<EstadoCuentaLeido | null>(null);
  const [moneda, setMoneda] = useState<"MXN" | "USD">("MXN");
  const [error, setError] = useState<string | null>(null);

  const elegir = async (f: File | null) => {
    setLeido(null);
    setError(null);
    setArchivo(f);
    if (!f) return;
    setLeyendo(true);
    try {
      const r = await leerEstadoCuentaPdf(f);
      if (!r.abonos.length) setError("No encontré abonos en este PDF. ¿Es el estado de cuenta de BBVA o Banregio?");
      setLeido(r);
      setMoneda(r.moneda);
    } catch {
      setError("No se pudo leer el PDF.");
    } finally {
      setLeyendo(false);
    }
  };
  const guardar = () =>
    start(async () => {
      if (!leido || !archivo) return;
      const fd = new FormData();
      fd.set("pdf", archivo);
      fd.set("datos", JSON.stringify({ banco: leido.banco, cuenta: leido.cuenta, moneda, desde: leido.desde, hasta: leido.hasta, abonos: leido.abonos.map(({ fecha, descripcion, referencia, monto }) => ({ fecha, descripcion, referencia, monto })) }));
      const r = await subirConciliacionAction(fd);
      if (!r.ok) return toast(r.error, "error");
      toast(r.nuevos ? `Listo: ${r.nuevos} abono(s) nuevo(s) para que los vendedores los identifiquen${r.repetidos ? ` (${r.repetidos} ya estaban)` : ""}.` : "Todos esos abonos ya estaban subidos.", "success");
      setArchivo(null);
      setLeido(null);
      router.push(`/finanzas/conciliaciones/${r.id}`);
    });

  return (
    <Card className="space-y-4 p-4">
      <div>
        <p className="font-semibold text-slate-900">Subir estado de cuenta</p>
        <p className="text-xs text-slate-500">PDF de BBVA o Banregio. Se toman solo los abonos (fecha, descripción y monto); los cargos no se guardan. Si subes otra vez un estado que ya tenía movimientos, no se repiten.</p>
      </div>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600 hover:border-brand-500">
        <input type="file" accept="application/pdf" className="hidden" onChange={(e) => elegir(e.target.files?.[0] ?? null)} />
        <span className="font-medium text-brand-700">{archivo ? archivo.name : "Elegir PDF del estado de cuenta"}</span>
        {leyendo && (
          <span className="flex items-center gap-2 text-slate-600">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
            Leyendo el estado de cuenta...
          </span>
        )}
      </label>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {leido && leido.abonos.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span><span className="text-slate-500">Banco:</span> <b>{leido.banco}</b></span>
            <span><span className="text-slate-500">Cuenta:</span> <b>{leido.cuenta ?? "?"}</b></span>
            <span className="flex items-center gap-1.5">
              <span className="text-slate-500">Moneda:</span>
              {(["MXN", "USD"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMoneda(m)} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${moneda === m ? (m === "USD" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-700 bg-slate-700 text-white") : "border-slate-300 bg-white text-slate-600"}`}>{m === "USD" ? "Dólares" : "Pesos"}</button>
              ))}
            </span>
            <span><span className="text-slate-500">Periodo:</span> {fecha(leido.desde)} al {fecha(leido.hasta)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <p className="rounded-lg border border-slate-200 px-3 py-2"><span className="block text-xs text-slate-500">Abonos</span><b>{leido.abonos.length}</b></p>
            <p className="rounded-lg border border-slate-200 px-3 py-2"><span className="block text-xs text-slate-500">Total abonos</span><b>{money2(leido.totalAbonos, moneda)}</b></p>
            <p className="rounded-lg border border-slate-200 px-3 py-2"><span className="block text-xs text-slate-500">Cargos (no se suben)</span><b>{leido.cargosIgnorados}</b></p>
            <p className={`rounded-lg border px-3 py-2 ${leido.noCuadran ? "border-amber-300 bg-amber-50" : "border-green-200 bg-green-50"}`}>
              <span className="block text-xs text-slate-500">Revisión con saldos</span>
              <b>{leido.noCuadran ? `${leido.noCuadran} no cuadran` : "Todo cuadra ✓"}</b>
            </p>
          </div>
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600">
                <tr><th className="px-3 py-2 text-left font-medium">Fecha</th><th className="px-3 py-2 text-left font-medium">Descripción</th><th className="px-3 py-2 text-right font-medium">Abono</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leido.abonos.map((a, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-3 py-1.5 align-top text-slate-600">{fecha(a.fecha)}</td>
                    <td className="px-3 py-1.5 text-slate-800">{a.descripcion}{a.referencia ? <span className="block text-xs text-slate-500">Ref. {a.referencia}</span> : null}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right align-top font-semibold tabular-nums">{money2(a.monto, moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" onClick={guardar} loading={pend}>Subir {leido.abonos.length} abono(s) a Conciliaciones</Button>
        </div>
      )}
    </Card>
  );
}
