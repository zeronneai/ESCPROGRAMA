"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { agregarCuentaDiariaAction, quitarCuentaDiariaAction, sinAbonosHoyAction } from "@/actions/conciliaciones";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import { EVENTO_CAMBIO } from "@/components/realtime-sync";
import { cuentaTxt, HORA_LIMITE, type CuentaHoy } from "@/lib/estados-cuenta-diarios";

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", timeZone: "America/Chihuahua" });

/** Estados de cuenta de hoy: uno por cuenta, lunes a viernes antes de las 9 am. */
export function CuentasDiarias({ cuentas, finanzas }: { cuentas: CuentaHoy[]; finanzas: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [banco, setBanco] = useState("BBVA");
  const [cuenta, setCuenta] = useState("");
  const [nombre, setNombre] = useState("");
  const [moneda, setMoneda] = useState<"MXN" | "USD">("MXN");
  const habil = cuentas[0]?.habil ?? true;
  const listos = cuentas.filter((c) => c.subido).length;
  const run = (f: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      const r = await f();
      if (!r.ok) return toast(r.error ?? "Error", "error");
      if (ok) toast(ok, "success");
      window.dispatchEvent(new CustomEvent(EVENTO_CAMBIO, { detail: "conciliaciones" }));
      router.refresh();
    });
  const inp = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Estados de cuenta de hoy {cuentas.length > 0 && <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${listos === cuentas.length ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>{listos} de {cuentas.length}</span>}</h2>
        <span className="text-xs text-slate-500">{habil ? `Uno por cuenta, de lunes a viernes antes de las ${HORA_LIMITE} am.` : "Hoy es fin de semana: no se piden."}</span>
      </div>
      {cuentas.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {cuentas.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-medium">{cuentaTxt(c)}</span>
              <span className="flex flex-wrap items-center gap-3 text-xs">
                {c.subido ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-800">{c.sin_abonos ? "Sin abonos hoy" : `Subido ${c.subido_at ? hora(c.subido_at) : ""}`}</span>
                ) : (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">Falta</span>
                )}
                {finanzas && !c.subido && habil && <button type="button" disabled={pend} className="text-slate-600 underline" onClick={() => run(() => sinAbonosHoyAction(c.id), "Marcada sin abonos hoy.")}>No tuvo abonos hoy</button>}
                {finanzas && c.sin_abonos && <button type="button" disabled={pend} className="text-slate-500 underline" onClick={() => run(() => sinAbonosHoyAction(c.id, true))}>Deshacer</button>}
                {finanzas && <button type="button" disabled={pend} className="text-slate-400 underline hover:text-red-600" onClick={() => run(() => quitarCuentaDiariaAction(c.id))}>Quitar</button>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">Todavía no hay cuentas. Agrega las cuentas del banco (o se agregan solas con los estados de cuenta ya subidos al correr la actualización).</p>
      )}
      {finanzas && (abierto ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
          <label className="text-xs text-slate-600">Banco<select className={`${inp} mt-1 block`} value={banco} onChange={(e) => setBanco(e.target.value)}><option>BBVA</option><option>Banregio</option><option>Otro</option></select></label>
          <label className="text-xs text-slate-600">Número de cuenta<input className={`${inp} mt-1 block w-44 font-mono`} value={cuenta} onChange={(e) => setCuenta(e.target.value)} placeholder="Como sale en el PDF" /></label>
          <label className="text-xs text-slate-600">Nombre (opcional)<input className={`${inp} mt-1 block w-40`} value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. BBVA pesos" /></label>
          <label className="text-xs text-slate-600">Moneda<select className={`${inp} mt-1 block`} value={moneda} onChange={(e) => setMoneda(e.target.value as "MXN" | "USD")}><option value="MXN">Pesos</option><option value="USD">Dólares</option></select></label>
          <Button loading={pend} onClick={() => run(() => agregarCuentaDiariaAction(banco, cuenta, nombre, moneda), "Cuenta agregada.")}>Agregar</Button>
          <button type="button" className="text-xs text-slate-500 underline" onClick={() => setAbierto(false)}>Cerrar</button>
        </div>
      ) : (
        <button type="button" className="text-xs font-medium text-brand-700 underline" onClick={() => setAbierto(true)}>+ Agregar cuenta</button>
      ))}
    </section>
  );
}
