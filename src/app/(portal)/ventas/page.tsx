import Link from "next/link";
import { DateTime } from "luxon";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireSalesViewer } from "@/lib/auth/sales";
import { getBusinessSettings } from "@/lib/quotes/server";
import { PERIODS, periodRange, summarizeSellers, totals, type Period, type SummaryBitacora, type SummaryVenta } from "@/lib/stats/sales-summary";
import { createClient } from "@/lib/supabase/server";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;

export default async function ResumenVentas({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  await requireSalesViewer();
  const sp = await searchParams;
  const periodo: Period = PERIODS.some((p) => p.id === sp.periodo) ? (sp.periodo as Period) : "mes";
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const now = DateTime.now().setZone(cfg.timezone);
  const { from, to } = periodRange(periodo, now);
  const fromIso = from.toUTC().toISO()!;
  const toIso = to.toUTC().toISO()!;

  const [sellers, requests, issues, bitacora, conversions, events, arts, ventas, lineas] = await Promise.all([
    supabase.from("profiles").select("id, nombre, activo").eq("rol", "vendedor").order("nombre"),
    supabase.from("quote_requests").select("vendedor_id, submitted_at").gte("submitted_at", fromIso).lte("submitted_at", toIso).limit(5000),
    supabase.from("quote_issues").select("emitida_por, request_id, emitida_at").gte("emitida_at", fromIso).lte("emitida_at", toIso).limit(5000),
    supabase
      .from("bitacora")
      .select("vendedor_id, resultado, proximo_seguimiento, created_at, updated_at, archived_at")
      .is("archived_at", null)
      .limit(10000),
    supabase.from("customers").select("convertido_por").gte("convertido_at", fromIso).lte("convertido_at", toIso).limit(5000),
    supabase.from("bitacora_eventos").select("created_by, created_at").gte("created_at", fromIso).lte("created_at", toIso).limit(20000),
    supabase.from("bitacora_articulos").select("articulo_id, articulos(clave, nombre), bitacora(archived_at)").limit(10000),
    supabase.from("ventas").select("vendedor_id, fecha, monto, moneda, pago, vence, porcentaje_cobrado, cancelada_at, request_id, created_at").limit(20000),
    supabase.from("venta_lineas").select("articulo_id, descripcion, cantidad, articulos(clave), ventas(fecha, cancelada_at)").not("articulo_id", "is", null).limit(20000),
  ]);
  type Top = { nombre: string; clave: string; ventas: number; piezas: number; prospeccion: number };
  const top: Record<string, Top> = {};
  const fromD = from.toISODate()!;
  const toD = to.toISODate()!;
  for (const l of (lineas.data ?? []) as unknown as { articulo_id: string; descripcion: string; cantidad: number | null; articulos: { clave: string } | null; ventas: { fecha: string; cancelada_at: string | null } | null }[]) {
    if (!l.ventas || l.ventas.cancelada_at || l.ventas.fecha < fromD || l.ventas.fecha > toD) continue;
    top[l.articulo_id] ??= { nombre: l.descripcion, clave: l.articulos?.clave ?? "", ventas: 0, piezas: 0, prospeccion: 0 };
    top[l.articulo_id].ventas++;
    top[l.articulo_id].piezas += Number(l.cantidad ?? 0);
  }
  for (const a of (arts.data ?? []) as unknown as { articulo_id: string; articulos: { clave: string; nombre: string } | null; bitacora: { archived_at: string | null } | null }[]) {
    if (!a.bitacora || a.bitacora.archived_at) continue;
    top[a.articulo_id] ??= { nombre: a.articulos?.nombre ?? "", clave: a.articulos?.clave ?? "", ventas: 0, piezas: 0, prospeccion: 0 };
    top[a.articulo_id].prospeccion++;
  }
  const topArts = Object.values(top).sort((a, b) => b.ventas - a.ventas || b.piezas - a.piezas || b.prospeccion - a.prospeccion).slice(0, 8);
  const err = [sellers, requests, issues, bitacora, conversions, events, ventas].find((r) => r.error)?.error;
  const rows = summarizeSellers({
    sellers: sellers.data ?? [],
    requests: (requests.data ?? []) as { vendedor_id: string; submitted_at: string }[],
    issues: issues.data ?? [],
    bitacora: (bitacora.data ?? []) as unknown as SummaryBitacora[],
    ventas: (ventas.data ?? []) as unknown as SummaryVenta[],
    conversions: conversions.data ?? [],
    events: events.data ?? [],
    fromDate: from.toISODate()!,
    toDate: to.toISODate()!,
    today: now.toISODate()!,
  });
  const visible = rows.filter((r) => r.activo || r.solicitudes || r.movimientos || r.ventas || r.prospectosActivos);
  const t = totals(visible);
  const sinBitacoraHoy = visible.filter((r) => r.activo && (!r.ultimaActividad || DateTime.fromISO(r.ultimaActividad).setZone(cfg.timezone).toISODate() !== now.toISODate()));
  const label = PERIODS.find((p) => p.id === periodo)!.label.toLowerCase();

  return (
    <div className="space-y-5">
      <PageHeader title="Resumen de ventas" subtitle={`Por vendedor: cotizaciones, ventas y prospección (${label}).`} />
      {err && <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudo cargar todo el resumen: {err.message}</Card>}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {PERIODS.map((p) => (
          <FilterChip key={p.id} href={p.id === "mes" ? "/ventas" : `/ventas?periodo=${p.id}`} active={periodo === p.id}>{p.label}</FilterChip>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Solicitudes a compras" value={t.solicitudes} />
        <StatCard label="Cotizaciones enviadas" value={t.cotizacionesEnviadas} />
        <StatCard label="Ventas" value={t.ventas} tone={t.ventas ? "green" : "default"} hint={t.montoVentas ? `${money(t.montoVentas)} MXN` : undefined} />
        <StatCard label="Prospectos activos" value={t.prospectosActivos} hint={`${t.prospectosNuevos} nuevos`} />
        <StatCard label="Prospectos que se volvieron clientes" value={t.convertidos} tone={t.convertidos ? "green" : "default"} />
        <StatCard label="Cartera vencida" value={money(t.carteraVencida)} tone={t.carteraVencida > 0 ? "red" : "default"} hint={t.porCobrar ? `${money(t.porCobrar)} por cobrar al corriente` : undefined} />
      </div>

      {periodo !== "mes_anterior" && sinBitacoraHoy.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 py-3 text-sm text-amber-900">
          Sin movimientos en la bitácora hoy: <strong>{sinBitacoraHoy.map((r) => r.nombre).join(", ")}</strong>
        </Card>
      )}

      {visible.length === 0 ? (
        <Card><EmptyState title="Aún no hay vendedores registrados" /></Card>
      ) : (
        <>
          {/* Escritorio: tabla */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Vendedor</th>
                  <th className="px-3 py-2.5 text-right">Solicitudes</th>
                  <th className="px-3 py-2.5 text-right">Cotiz. enviadas</th>
                  <th className="px-3 py-2.5 text-right">Ventas</th>
                  <th className="px-3 py-2.5 text-right">Monto</th>
                  <th className="px-3 py-2.5 text-right">Por cobrar</th>
                  <th className="px-3 py-2.5 text-right">Prospectos</th>
                  <th className="px-3 py-2.5 text-right">Convertidos</th>
                  <th className="px-3 py-2.5 text-right">Cartera vencida</th>
                  <th className="px-3 py-2.5 text-right">Movimientos</th>
                  <th className="px-4 py-2.5">Última actividad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/ventas/vendedor/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.nombre}</Link>
                      {!r.activo && <span className="ml-1 text-xs text-slate-400">(inactivo)</span>}
                      {r.seguimientosVencidos > 0 && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">{r.seguimientosVencidos} seguimiento(s) vencido(s)</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.solicitudes}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.cotizacionesEnviadas}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.ventas}{r.conversion !== null && <span className="ml-1 text-xs text-slate-400" title="Cotizaciones que terminaron en venta">{r.conversion}%</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.montoVentas ? money(r.montoVentas) : "-"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.porCobrar ? money(r.porCobrar) : "-"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.prospectosActivos}{r.prospectosNuevos > 0 && <span className="ml-1 text-xs text-green-700">+{r.prospectosNuevos}</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.convertidos}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${r.carteraVencida ? "text-red-700" : ""}`}>{r.carteraVencida ? money(r.carteraVencida) : "-"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.movimientos}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{r.ultimaActividad ? DateTime.fromISO(r.ultimaActividad).setZone(cfg.timezone).setLocale("es-MX").toRelative() : "Nunca"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {/* Movil: tarjetas */}
          <div className="space-y-3 md:hidden">
            {visible.map((r) => (
              <Link key={r.id} href={`/ventas/vendedor/${r.id}`} className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900">{r.nombre}</p>
                  <span className="text-xs text-slate-500">{r.ultimaActividad ? DateTime.fromISO(r.ultimaActividad).setZone(cfg.timezone).setLocale("es-MX").toRelative() : "Sin actividad"}</span>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  {[
                    ["Solicitudes", r.solicitudes],
                    ["Cotizaciones", r.cotizacionesEnviadas],
                    ["Ventas", r.ventas],
                    ["Prospectos", r.prospectosActivos],
                    ["Convertidos", r.convertidos],
                    ["Movimientos", r.movimientos],
                  ].map(([l, n]) => (
                    <div key={l} className="rounded-md bg-slate-50 py-2">
                      <dd className="text-lg font-semibold tabular-nums text-slate-900">{n}</dd>
                      <dt className="text-slate-500">{l}</dt>
                    </div>
                  ))}
                </dl>
                {(r.montoVentas > 0 || r.carteraVencida > 0 || r.seguimientosVencidos > 0) && (
                  <p className="mt-2 text-xs text-slate-600">
                    {r.montoVentas > 0 && <>Vendido {money(r.montoVentas)} MXN </>}
                    {r.carteraVencida > 0 && <span className="text-red-700">· Cartera {money(r.carteraVencida)} </span>}
                    {r.seguimientosVencidos > 0 && <span className="text-red-700">· {r.seguimientosVencidos} seguimiento(s) vencido(s)</span>}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </>
      )}
      {topArts.length > 0 && (
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Artículos más vendidos y ofrecidos</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {topArts.map((a) => (
              <li key={a.clave} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><p className="truncate text-slate-900">{a.nombre}</p><p className="text-xs text-slate-500">{a.clave}</p></div>
                <p className="shrink-0 text-xs text-slate-600">{a.ventas} venta(s){a.piezas ? ` · ${a.piezas.toLocaleString("es-MX")} pzas/cajas` : ""} · ofrecido a {a.prospeccion} prospecto(s)</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-xs text-slate-500">
        Ventas y monto salen de Ventas diarias del periodo; el % junto a ventas es cuántas cotizaciones enviadas terminaron en venta. Los montos en USD no se suman. Prospectos, por cobrar y cartera vencida son al día de hoy.
      </p>
    </div>
  );
}
