import Link from "next/link";
import { EmptyState, FilterChip, PageHeader } from "@/components/ui";
import { AtenderPedido, ReabrirPedido } from "@/components/pedidos/atender";
import { requireBuyer } from "@/lib/auth/guards";
import { FRECUENCIA_CORTA, mensualDe, type EstadoPedido, type Frecuencia } from "@/lib/pedidos";
import { fechaCortaMx, fmtNum } from "@/lib/planeacion";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = {
  id: string; clave: string | null; descripcion: string; cantidad: string; um: string | null; frecuencia: Frecuencia; cliente: string | null; notas: string | null;
  estado: EstadoPedido; oc_id: string | null; oc_folio: string | null; pedido_at: string | null; nota_comprador: string | null; created_at: string;
  profiles: { nombre: string } | null;
  plan_articulos: { nombre: string; proveedor_id: string; plan_proveedores: { nombre: string } | null } | null;
};

/** Pedidos de los vendedores al comprador. */
export default async function PedidosVendedores({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  await requireBuyer();
  const ver = (await searchParams).ver === "atendidos" ? "atendidos" : "activos";
  const supabase = await createClient();
  let q = supabase
    .from("pedidos_vendedor")
    .select("id, clave, descripcion, cantidad, um, frecuencia, cliente, notas, estado, oc_id, oc_folio, pedido_at, nota_comprador, created_at, profiles(nombre), plan_articulos(nombre, proveedor_id, plan_proveedores(nombre))")
    .order("created_at", { ascending: false })
    .limit(500);
  q = ver === "activos" ? q.eq("estado", "activo") : q.neq("estado", "activo");
  const { data, error } = await q;
  const rows = (data ?? []) as unknown as Row[];
  if (error)
    return (
      <div className="space-y-4">
        <PageHeader title="Pedidos de vendedores" />
        <EmptyState title="Falta la actualización de la base">Corre <code>0078_pedidos_vendedores.sql</code> en el SQL Editor de Supabase.</EmptyState>
      </div>
    );

  // Agrupados por proveedor; los "otro" aparte.
  const grupos = new Map<string, { nombre: string; id: string | null; rows: Row[] }>();
  for (const r of rows) {
    const key = r.plan_articulos?.proveedor_id ?? "otro";
    const g = grupos.get(key) ?? { nombre: r.plan_articulos?.plan_proveedores?.nombre ?? "Otros (no están en el kárdex)", id: r.plan_articulos?.proveedor_id ?? null, rows: [] };
    g.rows.push(r);
    grupos.set(key, g);
  }
  const orden = [...grupos.values()].sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || a.nombre.localeCompare(b.nombre));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pedidos de vendedores"
        subtitle={<>Lo que piden ventas, gerencia y dirección. Los de <b>una sola vez</b> se apartan en la planeación y se marcan pedidos solos cuando el artículo entra en una OC. Los <b>semanales, mensuales y anuales</b> se suman a la demanda de cada mes mientras estén activos.</>}
      />
      <div className="flex flex-wrap gap-2">
        <FilterChip href="/comprador/planeacion/pedidos" active={ver === "activos"}>Activos</FilterChip>
        <FilterChip href="/comprador/planeacion/pedidos?ver=atendidos" active={ver === "atendidos"}>Pedidos y cancelados</FilterChip>
      </div>
      {!rows.length && <EmptyState title={ver === "activos" ? "No hay pedidos activos" : "Todavía no hay pedidos atendidos"} />}
      {orden.map((g) => (
        <section key={g.id ?? "otro"} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{g.nombre}</h2>
            {g.id && ver === "activos" && <Link href={`/comprador/planeacion?p=${g.id}`} className="text-sm text-brand-700 underline">Ver en la planeación →</Link>}
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Artículo</th><th className="px-3 py-2 text-right">Cantidad</th><th className="px-3 py-2 text-left">Frecuencia</th>
                  <th className="px-3 py-2 text-left">Quién / cliente</th><th className="px-3 py-2 text-left">{ver === "activos" ? "Acción" : "Resultado"}</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => {
                  const c = Number(r.cantidad);
                  return (
                    <tr key={r.id} className="border-t border-slate-100 align-top">
                      <td className="max-w-[320px] px-3 py-2">
                        <p className="font-medium">{r.clave ?? <span className="rounded bg-violet-100 px-1.5 text-[11px] font-semibold text-violet-800">OTRO</span>}</p>
                        <p className="text-xs text-slate-600">{r.plan_articulos?.nombre ?? r.descripcion}</p>
                        {r.notas && <p className="text-xs text-slate-500">Nota: {r.notas}</p>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtNum(c, 2)} {r.um?.toLowerCase() ?? ""}</td>
                      <td className="px-3 py-2">
                        {FRECUENCIA_CORTA[r.frecuencia]}
                        {r.frecuencia !== "unica" && r.frecuencia !== "mensual" && <span className="block text-[11px] text-slate-500">≈ {fmtNum(mensualDe(r.frecuencia, c), 1)}/mes</span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.profiles?.nombre}
                        <span className="block text-xs text-slate-500">{r.cliente ? `${r.cliente} · ` : ""}{fechaCortaMx(r.created_at)}</span>
                      </td>
                      <td className="px-3 py-2">
                        {r.estado === "activo" ? (
                          <AtenderPedido id={r.id} conClave={!!r.clave} />
                        ) : (
                          <div className="space-y-1">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.estado === "pedido" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>
                              {r.estado === "pedido" ? "Pedido" : "Cancelado"}
                            </span>
                            {r.oc_id ? <Link href={`/comprador/planeacion/oc/${r.oc_id}`} className="ml-2 text-xs text-brand-700 underline">{r.oc_folio}</Link> : r.oc_folio ? <span className="ml-2 text-xs">{r.oc_folio}</span> : null}
                            {r.pedido_at && <span className="ml-2 text-xs text-slate-500">{fechaCortaMx(r.pedido_at)}</span>}
                            {r.nota_comprador && <p className="text-xs text-slate-600">{r.nota_comprador}</p>}
                            <div><ReabrirPedido id={r.id} /></div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
