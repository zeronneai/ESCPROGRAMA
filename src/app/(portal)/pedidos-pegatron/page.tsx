import { FechasOc, entregaMasProxima } from "@/components/pegatron/fechas-oc";
import Link from "next/link";
import { Alert, Card, EmptyState, FilterChip, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { RecuentoPegatron } from "@/components/pegatron/recuento";
import { recuentoPorArticulo } from "@/lib/pegatron-recuento";
import { facturasPorOc, fechaCorta } from "@/lib/pegatron-facturas";
import { createClient } from "@/lib/supabase/server";

type Linea = { id: string; articulo_esc: string; descripcion: string; cantidad: number | string; unidad: string | null; entrega?: string | null; pedido_at: string | null };
type Oc = { id: string; folio: string; po_numero: string; fecha: string | null; autor_nombre: string | null; created_at: string; tipo?: string | null; pegatron_oc_lineas: Linea[] };

const fmt = (n: number | string) => Number(n).toLocaleString("es-MX", { maximumFractionDigits: 3 });

export default async function PedidosPegatron({ searchParams }: { searchParams: Promise<{ ver?: string; seccion?: string }> }) {
  const u = await requireRoles(["jefe_ventas", "comprador", "gerente", "ceo"]);
  const { ver = "pendientes", seccion: sec } = await searchParams;
  const seccion = sec === "sobrepedido" ? "sobrepedido" : "linea";
  const supabase = await createClient();
  const consulta = (cols: string) =>
    supabase.from("pegatron_oc").select(`${cols}, pegatron_oc_lineas(id, articulo_esc, descripcion, cantidad, unidad, entrega, pedido_at)`).order("created_at", { ascending: false }).limit(300);
  let { data, error } = await consulta("id, folio, po_numero, fecha, autor_nombre, created_at, tipo");
  // Sin la 0064 todavia no hay secciones: todo cuenta como de linea.
  if (error && /tipo/.test(error.message)) ({ data, error } = await consulta("id, folio, po_numero, fecha, autor_nombre, created_at"));
  const todas = ((data ?? []) as unknown as Oc[]).map((o) => ({ ...o, tipo: o.tipo === "sobrepedido" ? "sobrepedido" : "linea", pend: o.pegatron_oc_lineas.filter((l) => !l.pedido_at).length }));
  const facturas = await facturasPorOc(supabase);
  const ocs = todas.filter((o) => o.tipo === seccion);
  const filas = ocs.filter((o) => (ver === "todas" ? true : ver === "pedidas" ? o.pend === 0 : o.pend > 0));
  const jefa = u.rol === "jefe_ventas";
  const recuento = recuentoPorArticulo(ocs.flatMap((o) => o.pegatron_oc_lineas.map((l) => ({ ...l, po: o.po_numero, oc_id: o.id }))));
  const pendDe = (t: string) => todas.filter((o) => o.tipo === t).reduce((a, o) => a + o.pend, 0);
  const href = (patch: Record<string, string>) => `/pedidos-pegatron?${new URLSearchParams({ seccion, ver, ...patch })}`;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Pedidos Pegatron"
        subtitle={jefa ? "Sube las órdenes de compra de Pegatron con el artículo ESC de cada renglón. Aquí ves qué ya pidió compras." : "Órdenes de compra de Pegatron: marca cada artículo cuando ya lo pediste."}
        actions={jefa ? <Link href="/pedidos-pegatron/nueva" className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">+ Nueva OC</Link> : null}
      />
      {error && <Alert tone="error">Primero corre la actualización 0053 en Supabase.</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          ["linea", "De línea", "Importación · entra a la planeación de compras", "border-brand-600 bg-brand-600 text-white", "border-brand-200 bg-white text-brand-900 hover:border-brand-400"],
          ["sobrepedido", "Sobrepedido", "Locales o productos no comunes", "border-orange-500 bg-orange-500 text-white", "border-orange-200 bg-white text-orange-900 hover:border-orange-400"],
        ] as const).map(([k, t, ayuda, on, off]) => (
          <Link key={k} href={href({ seccion: k, ver: "pendientes" })} className={`rounded-xl border-2 px-4 py-3 shadow-sm transition ${seccion === k ? on : off}`}>
            <span className="flex items-center justify-between gap-2 text-lg font-extrabold tracking-wide">
              {t.toUpperCase()}
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${seccion === k ? "bg-white/25" : "bg-slate-100 text-slate-700"}`}>{pendDe(k)} por pedir</span>
            </span>
            <span className={`block text-xs ${seccion === k ? "text-white/85" : "text-slate-500"}`}>{ayuda}</span>
          </Link>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Recuento por artículo ({seccion === "linea" ? "de línea" : "sobrepedido"})</h2>
        <p className="text-xs text-slate-500">Lo que falta por pedir sumado entre todas las órdenes{seccion === "linea" ? ". Lo que trae clave ESC- también aparece en Planeación de compras." : "."}</p>
        <RecuentoPegatron filas={recuento} comprador={u.rol === "comprador"} linea={seccion === "linea"} />
      </section>

      <h2 className="pt-2 text-base font-semibold">Órdenes</h2>
      <div className="flex flex-wrap gap-2">
        <FilterChip href={href({ ver: "pendientes" })} active={ver === "pendientes"}>Por pedir ({ocs.filter((o) => o.pend > 0).length})</FilterChip>
        <FilterChip href={href({ ver: "pedidas" })} active={ver === "pedidas"}>Ya pedidas</FilterChip>
        <FilterChip href={href({ ver: "todas" })} active={ver === "todas"}>Todas</FilterChip>
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
                      <p className="text-xs text-slate-500">Pegatron{o.autor_nombre ? ` · subió ${o.autor_nombre}` : ""}</p>
                      <div className="mt-1.5"><FechasOc subida={o.created_at} fechaOc={o.fecha} entrega={entregaMasProxima(o.pegatron_oc_lineas)} /></div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${o.pend === 0 ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>
                        {o.pend === 0 ? "Todo pedido" : `${total - o.pend} de ${total} pedidos`}
                      </span>
                      {facturas.get(o.id)?.length ? (
                        <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-800">
                          Facturado: {facturas.get(o.id)!.map((f) => `${f.factura ?? "s/folio"} (${fechaCorta(f.fecha)})`).join(", ")}
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">Sin facturar</span>
                      )}
                    </div>
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
