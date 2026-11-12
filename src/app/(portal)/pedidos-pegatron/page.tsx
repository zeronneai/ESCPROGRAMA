import Link from "next/link";
import { Alert, Card, EmptyState, FilterChip, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { createClient } from "@/lib/supabase/server";

type Linea = { id: string; articulo_esc: string; descripcion: string; cantidad: number | string; unidad: string | null; pedido_at: string | null };
type Oc = { id: string; folio: string; po_numero: string; fecha: string | null; autor_nombre: string | null; created_at: string; pegatron_oc_lineas: Linea[] };

const fmt = (n: number | string) => Number(n).toLocaleString("es-MX", { maximumFractionDigits: 3 });

export default async function PedidosPegatron({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const u = await requireRoles(["jefe_ventas", "comprador", "gerente", "ceo"]);
  const { ver = "pendientes" } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pegatron_oc")
    .select("id, folio, po_numero, fecha, autor_nombre, created_at, pegatron_oc_lineas(id, articulo_esc, descripcion, cantidad, unidad, pedido_at)")
    .order("created_at", { ascending: false })
    .limit(200);
  const ocs = ((data ?? []) as Oc[]).map((o) => ({ ...o, pend: o.pegatron_oc_lineas.filter((l) => !l.pedido_at).length }));
  const filas = ocs.filter((o) => (ver === "todas" ? true : ver === "pedidas" ? o.pend === 0 : o.pend > 0));
  const jefa = u.rol === "jefe_ventas";
  return (
    <div className="space-y-4">
      <PageHeader
        title="Pedidos Pegatron"
        subtitle={jefa ? "Sube las órdenes de compra de Pegatron con el artículo ESC de cada renglón. Aquí ves qué ya pidió compras." : "Órdenes de compra de Pegatron: marca cada artículo cuando ya lo pediste."}
        actions={jefa ? <Link href="/pedidos-pegatron/nueva" className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">+ Nueva OC</Link> : null}
      />
      {error && <Alert tone="error">Primero corre la actualización 0053 en Supabase.</Alert>}
      <div className="flex flex-wrap gap-2">
        <FilterChip href="/pedidos-pegatron?ver=pendientes" active={ver === "pendientes"}>Por pedir ({ocs.filter((o) => o.pend > 0).length})</FilterChip>
        <FilterChip href="/pedidos-pegatron?ver=pedidas" active={ver === "pedidas"}>Ya pedidas</FilterChip>
        <FilterChip href="/pedidos-pegatron?ver=todas" active={ver === "todas"}>Todas</FilterChip>
      </div>
      {filas.length === 0 ? (
        <EmptyState title={ver === "pendientes" ? "No hay artículos por pedir" : "No hay órdenes aquí"}>
          {jefa ? "Toca \"+ Nueva OC\" para subir una orden de compra de Pegatron." : "Cuando la jefa de ventas suba una orden, te llega aviso."}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {filas.map((o) => {
            const total = o.pegatron_oc_lineas.length;
            return (
              <Link key={o.id} href={`/pedidos-pegatron/${o.id}`} className="block">
                <Card className="space-y-2 p-4 transition hover:border-brand-300 hover:shadow-md">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">P/O {o.po_numero} <span className="ml-1 text-xs font-normal text-slate-500">{o.folio}</span></p>
                      <p className="text-xs text-slate-500">Pegatron{o.fecha ? ` · ${o.fecha.split("-").reverse().join("/")}` : ""}{o.autor_nombre ? ` · subió ${o.autor_nombre}` : ""}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${o.pend === 0 ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>
                      {o.pend === 0 ? "Todo pedido" : `${total - o.pend} de ${total} pedidos`}
                    </span>
                  </div>
                  <ul className="divide-y divide-slate-100 text-sm">
                    {o.pegatron_oc_lineas.slice(0, 5).map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="min-w-0 truncate"><span className="font-medium text-slate-900">{l.articulo_esc}</span> <span className="text-slate-500">· {l.descripcion}</span></span>
                        <span className="shrink-0 text-slate-700">{fmt(l.cantidad)} {l.unidad ?? ""} {l.pedido_at ? <span className="ml-1 text-green-700">✓</span> : null}</span>
                      </li>
                    ))}
                    {total > 5 && <li className="py-1.5 text-xs text-slate-500">y {total - 5} más</li>}
                  </ul>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
