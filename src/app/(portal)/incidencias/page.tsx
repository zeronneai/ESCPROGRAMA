import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { EditarIncidencia, IncidenciaForm } from "@/components/incidencias/form";
import { requireRoles } from "@/lib/auth/sales";
import { INCIDENCIA_CODIGO, INCIDENCIA_TIPOS, INCIDENCIA_VARIANTES, tipoTxt, type AlertaIncidencia, type Incidencia, type IncidenciaTipo } from "@/lib/incidencias";
import { fechaRh, MESES_LARGOS } from "@/lib/rrhh";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Bitacora de incidencias: la llena el supervisor de almacen; la consultan ventas, gerencia, ISO y compras. */
export default async function Incidencias({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const u = await requireRoles(["supervisor_almacen", "jefe_ventas", "gerente", "ceo", "coordinador_iso", "comprador"]);
  const sp = await searchParams;
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chihuahua" });
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : hoy.slice(0, 7);
  const [y, m] = mes.split("-").map(Number);
  const fin = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const mover = (d: number) => {
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const supabase = await createClient();
  const [lista, alertas] = await Promise.all([
    supabase.from("incidencias").select("*").gte("fecha", `${mes}-01`).lt("fecha", fin).order("fecha", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("incidencias_alertas").select("id, tipo, mes, n, sac_id").order("mes", { ascending: false }).limit(50),
  ]);
  const sup = u.rol === "supervisor_almacen";
  const iso = u.rol === "coordinador_iso";
  const header = <PageHeader title="Bitácora de incidencias" subtitle={`Formato ${INCIDENCIA_CODIGO}. La llena el supervisor de almacén; la consultan ventas, gerencia, el coordinador ISO y compras.`} />;
  if (lista.error) {
    return (
      <div className="space-y-5">
        {header}
        <EmptyState title="Falta la actualización de la base">Corre <code>0095_bitacora_incidencias.sql</code> en el SQL Editor de Supabase.</EmptyState>
      </div>
    );
  }
  const rows = (lista.data ?? []) as Incidencia[];
  const vivas = rows.filter((r) => !r.cancelada_at);
  const conteo = (Object.keys(INCIDENCIA_TIPOS) as IncidenciaTipo[]).map((k) => ({ k, n: vivas.filter((r) => r.tipo === k).length }));
  const pendientes = ((alertas.data ?? []) as AlertaIncidencia[]).filter((a) => !a.sac_id);
  const mesTxt = (d: string) => `${MESES_LARGOS[Number(d.slice(5, 7)) - 1].toLowerCase()} ${d.slice(0, 4)}`;

  return (
    <div className="space-y-5">
      {header}

      {pendientes.length > 0 && (
        <section className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4">
          <h2 className="text-sm font-semibold text-red-800">Se juntaron 3 o más de la misma incidencia en el mes: toca acción correctiva (RAC)</h2>
          <ul className="space-y-1.5 text-sm text-red-900">
            {pendientes.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                <span><b>{tipoTxt(a.tipo)}</b> · {a.n} en {mesTxt(a.mes)}</span>
                {iso ? (
                  <Link href={`/calidad/sac/nueva?alerta=${a.id}`} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">Llenar RAC</Link>
                ) : (
                  <span className="text-xs text-red-700">Pendiente: la llena el coordinador ISO</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sup && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Registrar incidencia</h2>
          <IncidenciaForm hoy={hoy} firma={u.nombre} />
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Link href={`/incidencias?mes=${mover(-1)}`} className="rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-50" aria-label="Mes anterior">‹</Link>
          <h2 className="text-base font-semibold">{MESES_LARGOS[m - 1]} {y}</h2>
          <Link href={`/incidencias?mes=${mover(1)}`} className="rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-50" aria-label="Mes siguiente">›</Link>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {conteo.map(({ k, n }) => (
            <div key={k} className={`rounded-lg border p-2.5 ${n >= 3 ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
              <p className="text-[11px] font-medium text-slate-500">{INCIDENCIA_TIPOS[k].n}. {INCIDENCIA_TIPOS[k].label}</p>
              <p className={`text-xl font-bold ${n >= 3 ? "text-red-700" : ""}`}>{n}</p>
            </div>
          ))}
        </div>
        {rows.length ? (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {rows.map((r) => (
              <li key={r.id} className={`space-y-1 px-4 py-3 ${r.cancelada_at ? "opacity-50" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {tipoTxt(r.tipo)}
                      {r.cancelada_at && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">CANCELADA</span>}
                    </p>
                    {r.variante && <p className="text-xs text-slate-600">Dañado en: {INCIDENCIA_VARIANTES[r.variante]}</p>}
                    <p className="text-sm text-slate-700">
                      {[r.producto, r.cliente, r.factura ? `Factura ${r.factura}` : null].filter(Boolean).join(" · ") || <span className="text-slate-400">Sin detalle</span>}
                    </p>
                    {r.accion && <p className="text-xs text-slate-600">Acción: {r.accion}</p>}
                    <p className="text-[11px] text-slate-400">{r.folio} · {fechaRh(r.fecha)} · Firma: {r.firma_nombre}</p>
                  </div>
                  {sup && !r.cancelada_at && <EditarIncidencia inc={r} hoy={hoy} />}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No hay incidencias registradas en este mes.</p>
        )}
      </section>
    </div>
  );
}
