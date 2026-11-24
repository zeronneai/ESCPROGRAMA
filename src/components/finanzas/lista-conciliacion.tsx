"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { marcarPagadaConciliacionAction, soltarPagoAction } from "@/actions/conciliaciones";
import { TomarPago } from "@/components/finanzas/tomar-pago";
import { toast } from "@/components/feedback-global";
import { Card, Input } from "@/components/ui";
import type { MovConc } from "@/lib/conciliaciones";
import { money2 } from "@/lib/ventas";

type Ver = "libres" | "mios" | "identificados" | "todos";
const fecha = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

/** Lista de abonos de conciliacion. Vendedor: identifica los suyos. Finanzas/jefa: ve quien tomo cada uno y puede soltarlo. */
export function ListaConciliacion({ movs, modo, uid }: { movs: MovConc[]; modo: "vendedor" | "finanzas"; uid: string }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [ver, setVer] = useState<Ver>(modo === "vendedor" ? "libres" : "todos");
  const [cuenta, setCuenta] = useState<string>("");
  const [buscar, setBuscar] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const cuentas = useMemo(() => [...new Map(movs.map((m) => [`${m.banco}|${m.cuenta ?? ""}`, m])).values()], [movs]);
  const t = buscar.trim().toLowerCase();
  const tn = Number(t.replace(/[$,\s]/g, ""));
  const lista = movs.filter((m) => {
    if (ver === "libres" && m.tomado_por) return false;
    if (ver === "identificados" && !m.tomado_por) return false;
    if (ver === "mios" && m.tomado_por !== uid) return false;
    if (cuenta && `${m.banco}|${m.cuenta ?? ""}` !== cuenta) return false;
    if (t && !(m.descripcion.toLowerCase().includes(t) || (m.referencia ?? "").toLowerCase().includes(t) || m.facturas.some((f) => f.folio.toLowerCase().includes(t)) || (tn > 0 && Math.abs(m.monto - tn) < 1))) return false;
    return true;
  });
  const cuenta_ = (v: Ver) => movs.filter((m) => (v === "libres" ? !m.tomado_por : v === "mios" ? m.tomado_por === uid : v === "identificados" ? !!m.tomado_por : true)).length;
  const soltar = (m: MovConc) =>
    start(async () => {
      const r = await soltarPagoAction(m.id);
      if (!r.ok) return toast(r.error, "error");
      toast("Pago soltado", "success");
      router.refresh();
    });
  const pagar = (filaId: string) =>
    start(async () => {
      const r = await marcarPagadaConciliacionAction(filaId);
      if (!r.ok) return toast(r.error, "error");
      toast("Factura marcada pagada con la fecha del abono", "success");
      router.refresh();
    });
  const opciones: Ver[] = modo === "vendedor" ? ["libres", "mios", "todos"] : ["todos", "libres", "identificados"];
  const nombre = { libres: "Sin identificar", mios: "Los míos", identificados: "Identificados", todos: "Todos" };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {opciones.map((v) => (
          <button key={v} type="button" onClick={() => setVer(v)} className={`rounded-full border px-3 py-1 text-sm ${ver === v ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
            {nombre[v]} {cuenta_(v)}
          </button>
        ))}
        {cuentas.length > 1 && (
          <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
            <option value="">Todas las cuentas</option>
            {cuentas.map((c) => <option key={`${c.banco}|${c.cuenta ?? ""}`} value={`${c.banco}|${c.cuenta ?? ""}`}>{c.banco} ···{(c.cuenta ?? "").slice(-4)}{c.moneda === "USD" ? " (USD)" : ""}</option>)}
          </select>
        )}
      </div>
      <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por nombre, folio o monto (ej. 5962.40)" />
      {lista.length === 0 && <Card className="text-sm text-slate-600">{ver === "libres" ? "No hay abonos sin identificar." : "No hay abonos en esta vista."}</Card>}
      <Card className="divide-y divide-slate-100 p-0">
        {lista.slice(0, 400).map((m) => {
          const mio = m.tomado_por === uid;
          const puedeSoltar = m.tomado_por && (modo === "finanzas" || (mio && !m.facturas.some((f) => f.marco_pagada)));
          return (
            <div key={m.id} className={`flex flex-wrap items-start gap-3 px-4 py-3 ${abierto === m.id ? "bg-brand-50/30" : ""}`}>
              <span className="w-16 shrink-0 text-sm text-slate-500">{fecha(m.fecha)}</span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="text-slate-800">{m.descripcion || "(sin descripción)"}</span>
                <span className="block text-xs text-slate-400">{m.banco} ···{(m.cuenta ?? "").slice(-4)}{m.referencia ? ` · Ref. ${m.referencia}` : ""}</span>
                {m.tomado_por && (
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${mio ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-700"}`}>{mio ? "Tomado por ti" : `Tomado por ${m.tomado_nombre ?? "otro vendedor"}`}</span>
                    {m.facturas.map((f) => (
                      <span key={f.id} className={`rounded-full px-2 py-0.5 ${f.pagada ? "bg-green-100 text-green-800" : !f.venta_id ? "bg-amber-100 text-amber-800" : "bg-orange-100 text-orange-800"}`}>
                        {f.folio}: {f.pagada ? "pagada" : !f.venta_id ? "falta subir su PDF" : "falta la comisión"}
                        {f.venta_id && !f.pagada && (mio || modo === "finanzas") && (
                          <>
                            {" · "}
                            {modo === "vendedor" && <Link href={`/vendedor/bitacora/venta/${f.venta_id}?comision=1#comision`} className="underline">poner comisión</Link>}
                            {" · "}
                            <button type="button" disabled={pend} onClick={() => pagar(f.id)} className="underline">marcar pagada</button>
                          </>
                        )}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-base font-bold tabular-nums text-slate-900">{money2(m.monto, m.moneda)}</span>
                {m.moneda === "USD" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">Dólares</span>}
                <span className="mt-1 flex justify-end gap-2 text-xs">
                  {modo === "vendedor" && !m.tomado_por && abierto !== m.id && (
                    <button type="button" onClick={() => setAbierto(m.id)} className="rounded-full bg-brand-700 px-3 py-1 font-semibold text-white hover:bg-brand-800">Es mío</button>
                  )}
                  {puedeSoltar && <button type="button" disabled={pend} onClick={() => soltar(m)} className="text-slate-500 hover:underline">Soltar</button>}
                </span>
              </span>
              {abierto === m.id && <div className="basis-full"><TomarPago mov={m} onClose={() => setAbierto(null)} /></div>}
            </div>
          );
        })}
      </Card>
      {lista.length > 400 && <p className="text-xs text-slate-500">Se muestran los primeros 400. Usa el buscador para encontrar otros.</p>}
    </div>
  );
}
