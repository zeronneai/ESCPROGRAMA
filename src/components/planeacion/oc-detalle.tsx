"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { estadoOcAction, guardarOcAction, recibirParcialAction, subirProformaAction } from "@/actions/planeacion";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import { ESTADOS_OC, fechaCortaMx, fmtNum, type EstadoOc } from "@/lib/planeacion";

export interface LineaOc {
  id: string;
  clave: string;
  nombre: string;
  cantidad: number;
  cantidad_proforma: number | null;
  recibido: number;
  recibido_fecha: string | null;
  precio: number | null;
  empaque: number | null;
  cbm_empaque: number | null;
}

type Oc = { id: string; folio: string; fecha: string; estado: EstadoOc; llegada_estimada: string | null; recibida_fecha: string | null; notas: string | null; origen: string; proforma_nombre: string | null };
type Prov = { id: string; nombre: string; origen: "china" | "usa"; recibe_parcial: boolean; entrega_dias: number; contenedor_cbm: number | null; tope_usd: number | null };

const PASOS: EstadoOc[] = ["borrador", "enviada", "proforma", "embarcada", "recibida"];

export function OcDetalle({ oc, prov, lineas, catalogo, proformaUrl, hoy }: { oc: Oc; prov: Prov; lineas: LineaOc[]; catalogo: { clave: string; nombre: string; precio: number | null }[]; proformaUrl: string | null; hoy: string }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [ls, setLs] = useState(lineas.map((l) => ({ ...l, rec: String(l.recibido || "") })));
  const [llegada, setLlegada] = useState(oc.llegada_estimada ?? "");
  const [notas, setNotas] = useState(oc.notas ?? "");
  const [nueva, setNueva] = useState({ clave: "", cantidad: "" });
  const [fechaRecibo, setFechaRecibo] = useState(hoy);
  const borrador = oc.estado === "borrador";
  const cerrada = oc.estado === "recibida" || oc.estado === "cancelada";
  const conProforma = !borrador && !cerrada;
  const parcial = prov.recibe_parcial && ["enviada", "proforma", "embarcada"].includes(oc.estado);
  const final = (l: LineaOc) => l.cantidad_proforma ?? l.cantidad;
  const tot = ls.reduce((s, l) => ({ piezas: s.piezas + final(l), importe: s.importe + final(l) * (l.precio ?? 0), cbm: s.cbm + (l.empaque && l.cbm_empaque ? (final(l) / l.empaque) * l.cbm_empaque : 0) }), { piezas: 0, importe: 0, cbm: 0 });
  const set = (id: string, patch: Partial<(typeof ls)[number]>) => setLs(ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const correr = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return toast(r.error ?? "No se pudo", "error");
      toast(ok, "success");
      router.refresh();
    });

  function guardar() {
    const nuevas = nueva.clave && Number(nueva.cantidad) > 0 ? [{ clave: nueva.clave, cantidad: Number(nueva.cantidad), precio: catalogo.find((c) => c.clave === nueva.clave)?.precio ?? null }] : [];
    correr(async () => {
      const r = await guardarOcAction(oc.id, {
        llegada_estimada: llegada || null,
        notas,
        lineas: ls.map((l) => ({ id: l.id, ...(borrador ? { cantidad: l.cantidad } : { cantidad_proforma: l.cantidad_proforma }), precio: l.precio })),
        nuevas,
      });
      if (r.ok) setNueva({ clave: "", cantidad: "" });
      return r;
    }, "Cambios guardados");
  }
  const cambiar = (e: EstadoOc, ok: string, extra: Record<string, string | null> = {}) => correr(() => estadoOcAction(oc.id, e, extra), ok);
  function subir(f: File | undefined) {
    if (!f) return;
    const fd = new FormData();
    fd.set("id", oc.id);
    fd.set("file", f);
    correr(() => subirProformaAction(fd), "Proforma guardada. Ajusta la columna Proforma si mandan otras cantidades.");
  }
  function recibir() {
    correr(async () => {
      const r = await recibirParcialAction(oc.id, ls.map((l) => ({ id: l.id, recibido: Number(l.rec) || 0 })), fechaRecibo);
      if (r.ok && r.cerrada) toast("Llegó todo: la OC quedó recibida.", "success");
      return r;
    }, "Recepción guardada");
  }
  async function copiar() {
    const t = [["Clave", "Artículo", "Cantidad", "Precio", "Importe"], ...ls.map((l) => [l.clave, l.nombre, final(l), l.precio ?? "", l.precio ? +(final(l) * l.precio).toFixed(2) : ""])].map((r) => r.join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(`${oc.folio} · ${prov.nombre}\n${t}`);
      toast("OC copiada. Pégala en Excel o en el correo.", "success");
    } catch {
      toast("No se pudo copiar en este navegador.", "error");
    }
  }

  const paso = PASOS.indexOf(oc.estado);
  const tarde = !cerrada && oc.llegada_estimada && oc.llegada_estimada < hoy;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">OC {oc.folio}</h1>
            <p className="text-sm text-slate-600">
              {prov.nombre} · {prov.origen === "china" ? "China" : "Americano"} · {fechaCortaMx(oc.fecha)}
              {oc.origen === "excel" && " · Tomada de tu Excel"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/planeacion/oc/${oc.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-lg bg-gradient-to-b from-brand-500 to-brand-700 px-3.5 py-2 text-sm font-medium text-white shadow-sm">Purchase Order (PDF)</a>
            <Button type="button" variant="secondary" onClick={copiar}>Copiar OC</Button>
          </div>
        </div>
        {oc.estado === "cancelada" ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">Cancelada: ya no cuenta como en camino.</p>
        ) : (
          <ol className="mt-4 flex flex-wrap gap-2 text-xs">
            {PASOS.map((p, i) => (
              <li key={p} className={`rounded-full px-3 py-1 font-semibold ${i < paso ? "bg-brand-100 text-brand-800" : i === paso ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                {i + 1}. {ESTADOS_OC[p]}
              </li>
            ))}
          </ol>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Llegada estimada
            <input type="date" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={llegada} onChange={(e) => setLlegada(e.target.value)} disabled={cerrada} />
          </label>
          {oc.estado === "recibida" && <p className="pb-2 text-sm text-green-800">Recibida el {fechaCortaMx(oc.recibida_fecha)}</p>}
          {tarde && <span className="mb-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Ya debió llegar: confirma con el proveedor y cambia la fecha</span>}
          <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs text-slate-600">
            Notas
            <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={notas} onChange={(e) => setNotas(e.target.value)} disabled={cerrada} placeholder="Ej. el proveedor confirma embarque el 15/dic" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {proformaUrl ? (
            <a href={proformaUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Ver proforma ({oc.proforma_nombre})</a>
          ) : (
            !borrador && !cerrada && <span className="text-slate-500">Sin proforma todavía.</span>
          )}
          {!cerrada && !borrador && (
            <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:border-brand-300">
              {proformaUrl ? "Cambiar proforma" : "Subir proforma"}
              <input type="file" className="sr-only" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg,.webp" onChange={(e) => subir(e.target.files?.[0])} />
            </label>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm tabular-nums">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Artículo</th>
              <th className="px-3 py-2 text-right">Pedido</th>
              <th className="px-3 py-2 text-right">Proforma</th>
              <th className="px-3 py-2 text-right">Recibido</th>
              <th className="px-3 py-2 text-right">Precio</th>
              <th className="px-3 py-2 text-right">Importe</th>
              {prov.origen === "china" && <th className="px-3 py-2 text-right">CBM</th>}
            </tr>
          </thead>
          <tbody>
            {ls.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="max-w-[320px] px-3 py-2">
                  <p className="font-medium">{l.clave}</p>
                  <p className="line-clamp-2 text-xs text-slate-500">{l.nombre}</p>
                </td>
                <td className="px-3 py-2 text-right">
                  {borrador ? (
                    <input type="number" min={0} aria-label={`Cantidad de ${l.clave}`} className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right" value={l.cantidad || ""} onChange={(e) => set(l.id, { cantidad: Math.max(0, Number(e.target.value) || 0) })} />
                  ) : (
                    fmtNum(l.cantidad)
                  )}
                  {l.empaque && l.empaque > 1 ? <span className="block text-[11px] text-slate-500">{fmtNum(l.cantidad / l.empaque, 1)} cajas</span> : null}
                </td>
                <td className="px-3 py-2 text-right">
                  {conProforma ? (
                    <input type="number" min={0} aria-label={`Cantidad de la proforma de ${l.clave}`} placeholder={fmtNum(l.cantidad)} className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right" value={l.cantidad_proforma ?? ""} onChange={(e) => set(l.id, { cantidad_proforma: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} />
                  ) : l.cantidad_proforma != null ? (
                    fmtNum(l.cantidad_proforma)
                  ) : (
                    ""
                  )}
                  {l.cantidad_proforma != null && l.cantidad_proforma !== l.cantidad && <span className="block text-[11px] text-amber-700">{l.cantidad_proforma < l.cantidad ? "mandan menos" : "mandan más"}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {parcial ? (
                    <input type="number" min={0} aria-label={`Recibido de ${l.clave}`} placeholder="0" className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right" value={l.rec} onChange={(e) => set(l.id, { rec: e.target.value })} />
                  ) : l.recibido ? (
                    <>
                      {fmtNum(l.recibido)}
                      {l.recibido_fecha && <span className="block text-[11px] text-slate-500">{fechaCortaMx(l.recibido_fecha)}</span>}
                    </>
                  ) : (
                    ""
                  )}
                </td>
                <td className="px-3 py-2 text-right">{l.precio != null ? `$${fmtNum(l.precio, 2)}` : ""}</td>
                <td className="px-3 py-2 text-right">{l.precio ? `$${fmtNum(final(l) * l.precio)}` : ""}</td>
                {prov.origen === "china" && <td className="px-3 py-2 text-right">{l.empaque && l.cbm_empaque ? fmtNum((final(l) / l.empaque) * l.cbm_empaque, 2) : ""}</td>}
              </tr>
            ))}
            {borrador && (
              <tr className="border-t border-slate-100 bg-slate-50/60">
                <td className="px-3 py-2">
                  <select aria-label="Agregar artículo" className="w-full max-w-[320px] rounded-md border border-slate-300 px-2 py-1 text-sm" value={nueva.clave} onChange={(e) => setNueva({ ...nueva, clave: e.target.value })}>
                    <option value="">+ Agregar artículo...</option>
                    {catalogo.filter((c) => !ls.some((l) => l.clave === c.clave)).map((c) => <option key={c.clave} value={c.clave}>{c.clave} · {c.nombre.slice(0, 60)}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-right"><input type="number" min={0} aria-label="Cantidad del artículo nuevo" className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right" value={nueva.cantidad} onChange={(e) => setNueva({ ...nueva, cantidad: e.target.value })} /></td>
                <td colSpan={prov.origen === "china" ? 5 : 4} className="px-3 py-2 text-xs text-slate-500">Para quitar un artículo pon su cantidad en 0 y guarda.</td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
            <tr>
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right" colSpan={3}>{fmtNum(tot.piezas)} piezas</td>
              <td />
              <td className="px-3 py-2 text-right">{tot.importe ? `$${fmtNum(tot.importe)}` : ""}</td>
              {prov.origen === "china" && <td className="px-3 py-2 text-right">{fmtNum(tot.cbm, 1)}{prov.contenedor_cbm ? ` / ${fmtNum(prov.contenedor_cbm)}` : ""}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
      {prov.tope_usd && tot.importe > prov.tope_usd && <p className="text-sm font-medium text-amber-800">Esta OC pasa el tope de ${fmtNum(prov.tope_usd)} USD.</p>}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {!cerrada && <Button type="button" variant="secondary" onClick={guardar} loading={pend}>Guardar cambios</Button>}
        {borrador && <Button type="button" onClick={() => cambiar("enviada", "OC marcada como enviada al proveedor")} loading={pend}>Marcar como enviada</Button>}
        {(oc.estado === "enviada" || oc.estado === "proforma") && <Button type="button" onClick={() => cambiar("embarcada", "OC embarcada", { llegada_estimada: llegada || null })} loading={pend}>Ya embarcó</Button>}
        {parcial && (
          <span className="flex flex-wrap items-center gap-2">
            <input type="date" aria-label="Fecha en que llegó" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={fechaRecibo} onChange={(e) => setFechaRecibo(e.target.value)} />
            <Button type="button" onClick={recibir} loading={pend}>Guardar lo que llegó</Button>
          </span>
        )}
        {["enviada", "proforma", "embarcada"].includes(oc.estado) && (
          <Button type="button" variant={parcial ? "secondary" : "primary"} onClick={() => cambiar("recibida", "OC recibida: ya suma a la existencia de planeación", { fecha: fechaRecibo })} loading={pend}>
            {prov.recibe_parcial ? "Llegó todo" : "Llegó completa"}
          </Button>
        )}
        {oc.estado === "recibida" && <Button type="button" variant="secondary" onClick={() => cambiar("embarcada", "Se regresó a embarcada")} loading={pend}>Regresar a embarcada</Button>}
        {oc.estado === "cancelada" && <Button type="button" variant="secondary" onClick={() => cambiar("borrador", "OC reabierta en borrador")} loading={pend}>Reabrir</Button>}
        {["borrador", "enviada", "proforma"].includes(oc.estado) && <Button type="button" variant="ghost" className="ml-auto text-red-700" onClick={() => cambiar("cancelada", "OC cancelada")} loading={pend}>Cancelar OC</Button>}
      </div>
      <p className="text-xs text-slate-500">
        {prov.recibe_parcial
          ? "Este proveedor puede llegar por partes: escribe en Recibido el total que ha llegado de cada artículo. Cuando llega todo, la OC se cierra sola."
          : "Este proveedor manda la orden completa: cuando llegue, usa Llegó completa. Si la proforma trae otras cantidades, ajusta la columna Proforma antes."}{" "}
        Lo recibido suma a la existencia de planeación (no al inventario de almacén).
      </p>
    </div>
  );
}
