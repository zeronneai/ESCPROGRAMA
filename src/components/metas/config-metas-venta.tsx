"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { borrarMetaVentaAction, guardarMetaVentaAction } from "@/actions/meta-prospeccion";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";

export type MetaFila = { id: string | null; nombre: string; vendedor_id: string | null; capturista_id: string | null; meta: number; estado: "activa" | "pausada"; alias_factura?: string | null };
type Usuario = { id: string; nombre: string; rol?: string };

function Fila({ m, usuarios, edita, nueva, alTerminar }: { m: MetaFila; usuarios: Usuario[]; edita: boolean; nueva?: boolean; alTerminar?: () => void }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [nombre, setNombre] = useState(m.nombre);
  const [vend, setVend] = useState(m.vendedor_id ?? "");
  const [capt, setCapt] = useState(m.capturista_id ?? "");
  const conAlias = m.alias_factura !== undefined;
  const [alias, setAlias] = useState(m.alias_factura ?? "");
  const [meta, setMeta] = useState(m.meta ? String(m.meta) : "");
  const [estado, setEstado] = useState(m.estado);
  const cambio = nueva || nombre !== m.nombre || vend !== (m.vendedor_id ?? "") || capt !== (m.capturista_id ?? "") || (conAlias && alias !== (m.alias_factura ?? "")) || Number(meta) !== m.meta || estado !== m.estado;
  const inp = "w-full rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50";
  const guardar = () =>
    start(async () => {
      const r = await guardarMetaVentaAction({ id: m.id, nombre, vendedor_id: vend || null, capturista_id: vend ? null : capt || null, ...(conAlias || nueva ? { alias_factura: alias.trim() || null } : {}), meta: Number(String(meta).replace(/[,$\s]/g, "")), estado });
      if (!r.ok) return toast(r.error, "error");
      toast("Meta guardada", "success");
      alTerminar?.();
      router.refresh();
    });
  return (
    <tr className="align-middle">
      <td className="px-3 py-2">
        <input className={inp} value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!edita} maxLength={120} aria-label="Nombre" />
        {(conAlias || nueva) && (
          <input className={`${inp} mt-1 text-xs`} value={alias} onChange={(e) => setAlias(e.target.value)} disabled={!edita} maxLength={150} placeholder="Como sale en la factura (si es distinto)" aria-label="Nombre en la factura" title="Vendedor como viene impreso en la factura de Microsip, ej. CASA LOCAL" />
        )}
      </td>
      <td className="px-3 py-2">
        <select className={inp} value={vend} onChange={(e) => { setVend(e.target.value); if (!nombre) setNombre(usuarios.find((u) => u.id === e.target.value)?.nombre ?? ""); }} disabled={!edita} aria-label="Usuario">
          <option value="">Sin usuario</option>
          {usuarios.filter((u) => u.rol !== "marketplaces").map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
      </td>
      <td className="px-3 py-2">
        {vend ? (
          <span className="text-xs text-slate-400">Las registra en Ventas diarias</span>
        ) : (
          <select className={inp} value={capt} onChange={(e) => setCapt(e.target.value)} disabled={!edita} aria-label="Quién captura sus ventas">
            <option value="">Nadie (solo la jefa)</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        )}
      </td>
      <td className="px-3 py-2"><input className={`${inp} text-right tabular-nums`} inputMode="decimal" value={meta} onChange={(e) => setMeta(e.target.value)} disabled={!edita} placeholder="0" aria-label="Meta mensual" /></td>
      <td className="px-3 py-2">
        <select className={inp} value={estado} onChange={(e) => setEstado(e.target.value as "activa" | "pausada")} disabled={!edita} aria-label="Estado">
          <option value="activa">Activa</option>
          <option value="pausada">En pausa</option>
        </select>
      </td>
      {edita && (
        <td className="whitespace-nowrap px-3 py-2">
          <div className="flex items-center gap-2">
            {cambio && <Button type="button" onClick={guardar} loading={pend}>Guardar</Button>}
            {nueva ? (
              <button type="button" className="text-xs text-slate-500 underline" onClick={alTerminar}>Cancelar</button>
            ) : (
              <button type="button" className="text-xs text-red-700 underline" disabled={pend} onClick={() => start(async () => {
                if (!window.confirm(`¿Quitar la meta de ${m.nombre}?`)) return;
                const r = await borrarMetaVentaAction(m.id!);
                if (!r.ok) return toast(r.error, "error");
                router.refresh();
              })}>Quitar</button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

/** Metas mensuales de venta: la jefa cambia montos, pausa, liga usuarios o agrega metas. */
export function ConfigMetasVenta({ metas, usuarios, edita }: { metas: MetaFila[]; usuarios: Usuario[]; edita: boolean }) {
  const [nueva, setNueva] = useState(false);
  const total = metas.filter((m) => m.estado === "activa").reduce((s, m) => s + m.meta, 0);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Usuario del portal</th><th className="px-3 py-2" title="Para metas sin usuario: quién sube sus ventas a mano">Quién captura sus ventas</th><th className="px-3 py-2 text-right">Meta mensual (MXN sin IVA)</th><th className="px-3 py-2">Estado</th>{edita && <th className="px-3 py-2" />}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {metas.map((m) => <Fila key={m.id} m={m} usuarios={usuarios} edita={edita} />)}
            {nueva && <Fila m={{ id: null, nombre: "", vendedor_id: null, capturista_id: null, meta: 0, estado: "activa" }} usuarios={usuarios} edita nueva alTerminar={() => setNueva(false)} />}
          </tbody>
          <tfoot><tr className="border-t border-slate-200 font-semibold"><td className="px-3 py-2" colSpan={3}>Total de metas activas (sin IVA)</td><td className="px-3 py-2 text-right tabular-nums">${Math.round(total).toLocaleString("es-MX")}</td><td colSpan={edita ? 2 : 1} /></tr></tfoot>
        </table>
      </div>
      {edita && !nueva && <Button type="button" variant="secondary" onClick={() => setNueva(true)}>Agregar meta</Button>}
    </div>
  );
}
