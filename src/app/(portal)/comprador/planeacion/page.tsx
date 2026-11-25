import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { Planeador } from "@/components/planeacion/planeador";
import { requireBuyer } from "@/lib/auth/guards";
import { calcular, ESTADOS_OC, fechaCortaMx, fmtNum, PARAMETROS_BASE } from "@/lib/planeacion";
import { cargarPlaneacion } from "@/lib/planeacion-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ESTADO_CLS: Record<string, string> = {
  borrador: "bg-slate-100 text-slate-700",
  enviada: "bg-brand-100 text-brand-800",
  proforma: "bg-violet-100 text-violet-800",
  embarcada: "bg-amber-100 text-amber-800",
  recibida: "bg-green-100 text-green-800",
  cancelada: "bg-red-100 text-red-700",
};

/** Planeacion de compras (solo comprador): venta real, existencia y propuesta de OC por proveedor. */
export default async function PlaneacionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireBuyer();
  const sp = await searchParams;
  const supabase = await createClient();
  let datos;
  try {
    datos = await cargarPlaneacion(supabase);
  } catch (e) {
    return (
      <div className="space-y-4">
        <PageHeader title="Planeación de compras" />
        <EmptyState title="Falta la actualización de la base">
          Corre <code>0059_planeacion_compras.sql</code> y luego <code>cargas/planeacion_compras_inicial.sql</code> en el SQL Editor. ({String((e as Error).message).slice(0, 120)})
        </EmptyState>
      </div>
    );
  }
  const { proveedores, articulos, ocs, corte, hoy, ventasPortal } = datos;
  if (!proveedores.length) {
    return (
      <div className="space-y-4">
        <PageHeader title="Planeación de compras" />
        <EmptyState title="Todavía no hay datos">Corre <code>cargas/planeacion_compras_inicial.sql</code> en el SQL Editor para cargar la existencia del kárdex, el historial y las OCs.</EmptyState>
      </div>
    );
  }
  const prov = proveedores.find((p) => p.id === sp.p) ?? proveedores[0];
  const resumen = new Map(proveedores.map((p) => [p.id, { rojo: 0, amarillo: 0, n: 0 }]));
  for (const a of articulos) {
    const p = proveedores.find((x) => x.id === a.proveedor_id);
    const r = resumen.get(a.proveedor_id);
    if (!p || !r) continue;
    const c = calcular(a, p, PARAMETROS_BASE, hoy);
    r.n += 1;
    if (c.semaforo === "rojo") r.rojo += 1;
    if (c.semaforo === "amarillo") r.amarillo += 1;
  }
  const mios = articulos.filter((a) => a.proveedor_id === prov.id);
  const ocsProv = ocs.filter((o) => o.proveedor_id === prov.id && (sp.todas ? true : o.estado !== "recibida" && o.estado !== "cancelada"));
  const cerradas = ocs.filter((o) => o.proveedor_id === prov.id && (o.estado === "recibida" || o.estado === "cancelada")).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Planeación de compras"
        subtitle={
          <>
            Existencia de Microsip al <b>{fechaCortaMx(corte)}</b>, menos lo vendido en el portal desde entonces ({fmtNum(ventasPortal)} renglones de venta), más lo recibido de las OCs.
            Solo para planear: no cambia el inventario de almacén.
          </>
        }
      />
      <Link href="/comprador/planeacion/inventario" className="inline-flex items-center gap-2 rounded-lg border border-brand-300 bg-white px-3 py-2 text-sm font-semibold text-brand-800 shadow-sm hover:bg-brand-50">
        Ver inventario por artículo (con buscador y las ventas que lo descontaron) →
      </Link>

      <div className="space-y-2">
        {(["usa", "china"] as const).map((origen) => (
          <nav key={origen} className="flex flex-wrap items-center gap-2" aria-label={origen === "usa" ? "Proveedores americanos" : "Proveedores asiáticos"}>
            <span className={`w-24 shrink-0 text-xs font-bold uppercase tracking-wide ${origen === "usa" ? "text-amber-700" : "text-red-700"}`}>{origen === "usa" ? "Americanos" : "Asiáticos"}</span>
            {proveedores.filter((p) => p.origen === origen).map((p) => {
              const r = resumen.get(p.id)!;
              const act = p.id === prov.id;
              const tono = origen === "usa"
                ? act ? "border-amber-500 bg-amber-400 text-amber-950 shadow-sm" : "border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-400"
                : act ? "border-red-600 bg-red-600 text-white shadow-sm" : "border-red-200 bg-red-50 text-red-900 hover:border-red-400";
              return (
                <Link key={p.id} href={`/comprador/planeacion?p=${p.id}`} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${tono}`}>
                  {p.nombre.toUpperCase()}
                  <span className="text-[11px] opacity-70">{r.n}</span>
                  {r.rojo > 0 && <span className={`rounded-full px-1.5 text-[11px] font-semibold ${act ? "bg-white/30" : "bg-red-600 text-white"}`} title="Se acaban antes de que llegue un pedido">{r.rojo}</span>}
                </Link>
              );
            })}
          </nav>
        ))}
      </div>

      <Planeador key={prov.id} prov={prov} articulos={mios} hoy={hoy} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">OCs de {prov.nombre}</h2>
          <Link className="text-sm text-brand-700 underline" href={`/comprador/planeacion?p=${prov.id}${sp.todas ? "" : "&todas=1"}`}>
            {sp.todas ? "Ver solo las abiertas" : `Ver también recibidas y canceladas (${cerradas})`}
          </Link>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Folio</th><th className="px-3 py-2 text-left">Fecha</th><th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Llegada estimada</th><th className="px-3 py-2 text-right">Artículos</th><th className="px-3 py-2 text-right">Piezas</th><th className="px-3 py-2 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {ocsProv.map((o) => {
                const tarde = o.estado !== "recibida" && o.estado !== "cancelada" && o.llegada_estimada && o.llegada_estimada < hoy;
                return (
                  <tr key={o.id} className="border-t border-slate-100 hover:bg-brand-50/50">
                    <td className="px-3 py-2"><Link className="font-medium text-brand-700 underline" href={`/comprador/planeacion/oc/${o.id}`}>{o.folio}</Link></td>
                    <td className="px-3 py-2">{fechaCortaMx(o.fecha)}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_CLS[o.estado]}`}>{ESTADOS_OC[o.estado]}</span></td>
                    <td className="px-3 py-2">
                      {o.estado === "recibida" ? `Llegó ${fechaCortaMx(o.recibida_fecha)}` : fechaCortaMx(o.llegada_estimada)}
                      {tarde && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Ya debió llegar, confirmar</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{o.lineas}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(o.piezas)}</td>
                    <td className="px-3 py-2 text-right">{o.importe ? `$${fmtNum(o.importe)}` : ""}</td>
                  </tr>
                );
              })}
              {!ocsProv.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No hay OCs en esta vista.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
