"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { marcarPagadaConciliacionAction, marcarPrevioAction, quitarPrevioAction, soltarPagoAction } from "@/actions/conciliaciones";
import { IdentificarPara, TomarPago } from "@/components/finanzas/tomar-pago";
import { toast } from "@/components/feedback-global";
import { Card, Input } from "@/components/ui";
import { diasRestantes, type MovConc } from "@/lib/conciliaciones";
import { money2 } from "@/lib/ventas";

type Ver = "libres" | "vencidos" | "mios" | "identificados" | "previos" | "todos";
const fecha = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

/**
 * Lista de abonos de conciliacion.
 * - vendedor: identifica los suyos.
 * - finanzas: ve quien tomo cada uno y puede soltarlo.
 * - direccion (jefa, gerente, CEO): ademas identifica a nombre de un vendedor.
 * Cada abono tiene 7 dias para identificarse; despues pasa a "No identificados" (rojo).
 */
export function ListaConciliacion({ movs, modo, uid, vendedores = [], inicial, today, almacen, puedePrevio }: { movs: MovConc[]; modo: "vendedor" | "finanzas" | "direccion"; uid: string; vendedores?: { id: string; nombre: string }[]; inicial?: Ver; today?: string; almacen?: boolean; /** Jefa, gerente, CEO o comprador: marcar pagos identificados antes del portal. */ puedePrevio?: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [ver, setVer] = useState<Ver>(inicial ?? (modo === "vendedor" ? "libres" : "todos"));
  const vencido = (m: MovConc) => !m.tomado_por && diasRestantes(m.created_at) <= 0;
  const [cuenta, setCuenta] = useState<string>("");
  // Por vendedor (finanzas, jefa, gerente): a nombre de quien quedo cada pago.
  const quienPrevio = (m: MovConc) => m.tomado_para ?? (m.tomado_nombre && m.tomado_nombre !== "Identificado antes del portal" ? m.tomado_nombre : null);
  const quien = (m: MovConc) => (m.previo ? (quienPrevio(m) ?? "Antes del portal") : m.tomado_por ? (m.tomado_para ?? m.tomado_nombre ?? "Otro") : null);
  const [previoAbierto, setPrevioAbierto] = useState<string | null>(null);
  const [vend, setVend] = useState<string>("");
  const vends = useMemo(() => [...new Set(movs.map(quien).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)), [movs]);
  const [buscar, setBuscar] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const cuentas = useMemo(() => [...new Map(movs.map((m) => [`${m.banco}|${m.cuenta ?? ""}`, m])).values()], [movs]);
  const t = buscar.trim().toLowerCase();
  const tn = Number(t.replace(/[$,\s]/g, ""));
  const lista = movs.filter((m) => {
    if (ver === "libres" && (m.tomado_por || vencido(m))) return false;
    if (ver === "vencidos" && !vencido(m)) return false;
    if (ver === "identificados" && !m.tomado_por) return false;
    if (ver === "previos" && !m.previo) return false;
    if (ver === "mios" && m.vendedor_id !== uid) return false;
    if (cuenta && `${m.banco}|${m.cuenta ?? ""}` !== cuenta) return false;
    if (vend && quien(m) !== vend) return false;
    if (t && !(m.descripcion.toLowerCase().includes(t) || (m.referencia ?? "").toLowerCase().includes(t) || m.facturas.some((f) => f.folio.toLowerCase().includes(t)) || (tn > 0 && Math.abs(m.monto - tn) < 1))) return false;
    return true;
  });
  const cuenta_ = (v: Ver) => movs.filter((m) => (v === "libres" ? !m.tomado_por && !vencido(m) : v === "vencidos" ? vencido(m) : v === "mios" ? m.vendedor_id === uid : v === "identificados" ? !!m.tomado_por : v === "previos" ? !!m.previo : true)).length;
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
  const opciones: Ver[] = modo === "vendedor" ? ["libres", "vencidos", "mios", "todos"] : ["vencidos", "libres", "identificados", ...(movs.some((m) => m.previo) ? (["previos"] as Ver[]) : []), "todos"];
  const nombre = { libres: "Por identificar", vencidos: "No identificados (+7 días)", mios: "Los míos", identificados: "Identificados", previos: "Antes del portal", todos: "Todos" };
  const deshacerPrevio = (m: MovConc) =>
    start(async () => {
      if (!window.confirm("¿Deshacer? El pago vuelve a quedar sin identificar.")) return;
      const r = await quitarPrevioAction(m.id);
      if (!r.ok) return toast(r.error, "error");
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {opciones.map((v) => (
          <button key={v} type="button" onClick={() => setVer(v)} className={`rounded-full border px-3 py-1 text-sm ${ver === v ? (v === "vencidos" ? "border-red-600 bg-red-600 text-white" : "border-slate-800 bg-slate-800 text-white") : v === "vencidos" && cuenta_(v) ? "border-red-300 bg-red-50 text-red-800" : "border-slate-300 bg-white text-slate-700"}`}>
            {nombre[v]} {cuenta_(v)}
          </button>
        ))}
        {cuentas.length > 1 && (
          <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
            <option value="">Todas las cuentas</option>
            {cuentas.map((c) => <option key={`${c.banco}|${c.cuenta ?? ""}`} value={`${c.banco}|${c.cuenta ?? ""}`}>{c.banco} ···{(c.cuenta ?? "").slice(-4)}{c.moneda === "USD" ? " (USD)" : ""}</option>)}
          </select>
        )}
        {modo !== "vendedor" && vends.length > 0 && (
          <select value={vend} onChange={(e) => { setVend(e.target.value); if (e.target.value && ver !== "todos") setVer("identificados"); }} className="rounded-md border border-slate-300 px-2 py-1 text-sm" aria-label="Vendedor">
            <option value="">Todos los vendedores</option>
            {vends.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
      </div>
      {vend && (
        <p className="text-sm text-slate-700">
          <b>{vend}</b>: {lista.length} pago(s) · {lista.reduce((n, m) => n + m.facturas.length, 0)} factura(s) ·{" "}
          {["MXN", "USD"].map((mon) => { const t2 = lista.filter((m) => m.moneda === mon).reduce((a, m) => a + m.monto, 0); return t2 ? `$${t2.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${mon === "USD" ? " USD" : ""}` : null; }).filter(Boolean).join(" · ")}
        </p>
      )}
      <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por nombre, folio o monto (ej. 5962.40)" />
      {lista.length === 0 && <Card className="text-sm text-slate-600">{ver === "libres" ? "No hay abonos sin identificar." : "No hay abonos en esta vista."}</Card>}
      <Card className="divide-y divide-slate-100 p-0">
        {lista.slice(0, 400).map((m) => {
          const mio = m.vendedor_id === uid;
          const puedeSoltar = m.tomado_por && !m.previo && (modo !== "vendedor" || (m.tomado_por === uid && !m.facturas.some((f) => f.marco_pagada)));
          const dias = diasRestantes(m.created_at);
          const rojo = !m.tomado_por && dias <= 0;
          return (
            <div key={m.id} className={`flex flex-wrap items-start gap-3 px-4 py-3 ${rojo ? "border-l-4 border-red-500 bg-red-50/70" : abierto === m.id ? "bg-brand-50/30" : ""}`}>
              <span className="w-16 shrink-0 text-sm text-slate-500">{fecha(m.fecha)}</span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="text-slate-800">{m.descripcion || "(sin descripción)"}</span>
                <span className="block text-xs text-slate-400">{m.banco} ···{(m.cuenta ?? "").slice(-4)}{m.referencia ? ` · Ref. ${m.referencia}` : ""}</span>
                {!m.tomado_por && (
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${rojo ? "bg-red-600 text-white" : dias <= 2 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                    {rojo ? `No identificado · venció hace ${Math.max(-dias, 1)} día(s): comisión −10%` : `Quedan ${dias} día(s) para identificarlo`}
                  </span>
                )}
                {m.previo && (
                  <span className="mt-1 block space-y-1 text-xs">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-800">Identificado antes del portal{quienPrevio(m) ? ` · ${quienPrevio(m)}` : ""}</span>
                      {m.facturas.length > 0 && <span className="text-slate-500">{m.facturas.length} factura(s):</span>}
                      {m.facturas.slice(0, 60).map((f) => <span key={f.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">{f.folio}</span>)}
                      {m.facturas.length > 60 && <span className="text-slate-500">y {m.facturas.length - 60} más</span>}
                    </span>
                    {m.previo_nota && <span className="block text-slate-600">Nota: {m.previo_nota}</span>}
                  </span>
                )}
                {m.tomado_por && !m.previo && (
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${mio ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-700"}`}>{mio ? (m.tomado_por === uid ? "Tomado por ti" : "Identificado a tu nombre") : (m.tomado_para ? `Identificado a nombre de ${m.tomado_para}` : `Tomado por ${m.tomado_nombre ?? "otro vendedor"}`)}</span>
                    {m.tardio && <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800">Identificado tarde: comisión −10%, siguiente quincena</span>}
                    {m.facturas.map((f) => (
                      <span key={f.id} className={`rounded-full px-2 py-0.5 ${f.pagada ? "bg-green-100 text-green-800" : !f.venta_id ? "bg-amber-100 text-amber-800" : "bg-orange-100 text-orange-800"}`}>
                        {f.folio}: {f.pagada ? "pagada" : !f.venta_id ? "falta subir su PDF" : "falta la comisión"}
                        {f.venta_id && !f.pagada && (mio || modo !== "vendedor") && (
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
                    <button type="button" onClick={() => setAbierto(m.id)} className="rounded-full bg-brand-700 px-3 py-1 font-semibold text-white hover:bg-brand-800">Identificar</button>
                  )}
                  {modo === "direccion" && !m.tomado_por && abierto !== m.id && (
                    <button type="button" onClick={() => setAbierto(m.id)} className="rounded-full bg-slate-800 px-3 py-1 font-semibold text-white hover:bg-slate-900">Identificar</button>
                  )}
                  {puedeSoltar && <button type="button" disabled={pend} onClick={() => soltar(m)} className="text-slate-500 hover:underline">Soltar</button>}
                  {puedePrevio && !m.tomado_por && previoAbierto !== m.id && (
                    <button type="button" onClick={() => setPrevioAbierto(m.id)} className="rounded-full border border-indigo-300 px-3 py-1 font-semibold text-indigo-800 hover:bg-indigo-50" title="Ya se había identificado a mano antes del portal">Ya identificado antes</button>
                  )}
                  {puedePrevio && m.previo && <button type="button" disabled={pend} onClick={() => deshacerPrevio(m)} className="text-slate-500 hover:underline">Deshacer</button>}
                </span>
              </span>
              {previoAbierto === m.id && (
                <div className="basis-full">
                  <MarcarPrevio mov={m} vendedores={vendedores} onClose={() => setPrevioAbierto(null)} />
                </div>
              )}
              {abierto === m.id && (
                <div className="basis-full">
                  {modo === "direccion" ? <IdentificarPara mov={m} vendedores={vendedores} onClose={() => setAbierto(null)} /> : <TomarPago mov={m} onClose={() => setAbierto(null)} today={today} almacen={almacen} />}
                </div>
              )}
            </div>
          );
        })}
      </Card>
      {lista.length > 400 && <p className="text-xs text-slate-500">Se muestran los primeros 400. Usa el buscador para encontrar otros.</p>}
    </div>
  );
}

/** Pago identificado a mano antes del portal: folios (aunque las facturas no esten subidas), asesor y nota. */
function MarcarPrevio({ mov, vendedores, onClose }: { mov: MovConc; vendedores: { id: string; nombre: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [folios, setFolios] = useState("");
  const [para, setPara] = useState("");
  const [nota, setNota] = useState("");
  const n = [...new Set(folios.toUpperCase().split(/[\s,;]+/).filter(Boolean))].length;
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-sm">
      <p className="text-indigo-900">Este pago ya se había identificado antes del portal. Queda como identificado y nadie lo puede tomar ni cambiar (finanzas tampoco).</p>
      <label className="block text-xs font-medium text-slate-700">
        Folios de las facturas (pégalos separados por espacio, coma o renglón)
        <textarea className="mt-1 h-24 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs" value={folios} onChange={(e) => setFolios(e.target.value)} placeholder="F10815, F10817, F10785..." />
      </label>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs font-medium text-slate-700">
          Asesor (opcional)
          <input list={`vend-${mov.id}`} className="mt-1 block w-56 rounded-md border border-slate-300 px-2 py-1 text-sm" value={para} onChange={(e) => setPara(e.target.value)} maxLength={120} />
          <datalist id={`vend-${mov.id}`}>{vendedores.map((v) => <option key={v.id} value={v.nombre} />)}</datalist>
        </label>
        <label className="min-w-[14rem] flex-1 text-xs font-medium text-slate-700">
          Nota (opcional)
          <input className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={1000} placeholder="Ej. Pago Pegatron de 33 facturas, recibido en físico" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pend || (!n && !nota.trim())}
          className="rounded-full bg-indigo-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
          onClick={() =>
            start(async () => {
              const r = await marcarPrevioAction(mov.id, folios, nota, para);
              if (!r.ok) return toast(r.error, "error");
              toast(`Listo: pago identificado antes del portal${r.n ? ` con ${r.n} factura(s)` : ""}`, "success");
              onClose();
              router.refresh();
            })
          }
        >
          {pend ? "Guardando…" : `Marcar como identificado${n ? ` (${n} folios)` : ""}`}
        </button>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 underline">Cancelar</button>
      </div>
    </div>
  );
}
