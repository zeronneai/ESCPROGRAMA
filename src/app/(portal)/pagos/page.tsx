import Link from "next/link";
import { DateTime } from "luxon";
import { Icon } from "@/components/icons";
import { Chip } from "@/components/ops-ui";
import { ProveedoresPagos, type ProvPagos } from "@/components/pagos/proveedores-pagos";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { CARGA, ESTADO_PAGO, fmtMonto, fmtTotales, OC_COLS, ordenPagos, PAGO_COLS, prioridadPago, pagoVencido, TIPO_PAGO, totalesPorMoneda, type OcRow, type PagoRow, netoPago } from "@/lib/pagos";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

const VISTAS = { pendientes: "Pendientes", por_pagar: "Por pagar", comprobantes: "Comprobantes por descargar", historial: "Historial" } as const;
type Vista = keyof typeof VISTAS;
const fecha = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "");

export default async function Pagos({ searchParams }: { searchParams: Promise<{ ver?: string; prov?: string }> }) {
  const u = await requireRoles(["comprador", "ceo"]);
  const sp = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const today = DateTime.now().setZone(cfg.timezone).toISODate()!;
  const comprador = u.rol === "comprador";
  const [{ data: ocs }, { data: ps }, { data: sups }] = await Promise.all([
    supabase.from("ordenes_compra").select(OC_COLS).order("fecha", { ascending: false }).limit(3000),
    supabase.from("pagos").select(PAGO_COLS).order("created_at").limit(10000),
    supabase.from("suppliers").select("id, nombre, pais, tipo, en_pagos, pagos_moneda, activo").order("nombre").limit(5000),
  ]);
  const ordenes = (ocs ?? []) as unknown as OcRow[];
  const pagos = (ps ?? []) as PagoRow[];
  const ocMap = new Map(ordenes.map((o) => [o.id, o]));
  const conMoneda = (l: PagoRow[]) => l.map((p) => ({ monto: netoPago(p), moneda: ocMap.get(p.oc_id)?.moneda ?? "USD" }));
  const enPagos = (sups ?? []).filter((s) => s.en_pagos);

  const porPagar = pagos.filter((p) => p.estado === "pendiente");
  const urgentes = porPagar.filter((p) => p.urgente);
  const sinLiberar = porPagar.filter((p) => p.carga === "sin_liberar");
  const pagadosSinBajar = pagos.filter((p) => p.estado === "pagado");
  const mesIni = today.slice(0, 7);
  const pagadosMes = pagos.filter((p) => (p.estado === "pagado" || p.estado === "cerrado") && p.pago_fecha?.startsWith(mesIni));
  const vencidos = pagos.filter((p) => pagoVencido(p, today));

  const ver: Vista = sp.ver && sp.ver in VISTAS ? (sp.ver as Vista) : comprador ? "pendientes" : "por_pagar";
  const prov = sp.prov && enPagos.some((s) => s.id === sp.prov) ? sp.prov : "";
  const filtro = (p: PagoRow) =>
    ver === "pendientes" ? p.estado !== "cerrado" : ver === "por_pagar" ? p.estado === "pendiente" : ver === "comprobantes" ? p.estado === "pagado" : p.estado === "cerrado";
  const visibles = ordenPagos(pagos, today).filter((p) => filtro(p) && (!prov || ocMap.get(p.oc_id)?.supplier_id === prov));
  // OCs sin facturas todavia (solo en pendientes)
  const ocSinPagos = ver === "pendientes" ? ordenes.filter((o) => !o.cerrada_at && !pagos.some((p) => p.oc_id === o.id) && (!prov || o.supplier_id === prov)) : [];
  const grupos = enPagos
    .map((s) => ({
      s,
      pagos: visibles.filter((p) => ocMap.get(p.oc_id)?.supplier_id === s.id),
      sinPagos: ocSinPagos.filter((o) => o.supplier_id === s.id),
    }))
    .filter((g) => g.pagos.length || g.sinPagos.length)
    .sort((a, b) => Math.min(9, ...a.pagos.map((p) => prioridadPago(p, today))) - Math.min(9, ...b.pagos.map((p) => prioridadPago(p, today))));
  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ver: sp.ver, prov: prov || undefined, ...o })) if (v) p.set(k, v);
    return `/pagos${p.size ? `?${p}` : ""}`;
  };
  const provList: ProvPagos[] = (sups ?? []).filter((s) => s.activo || s.en_pagos).map((s) => ({ ...s, ocs: ordenes.filter((o) => o.supplier_id === s.id).length }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pagos a proveedores extranjeros"
        subtitle={comprador ? "Registra cada OC con sus facturas o anticipos; el CEO las ve para pagar. Marca si la carga ya se liberó, lo urgente y comentarios. Al descargar el comprobante pasa al historial." : "Facturas por pagar a proveedores extranjeros. Primero lo urgente y lo que tiene la carga detenida. Marca cada pago y sube el comprobante."}
        actions={comprador ? (
          <Link href={`/pagos/oc/nueva${prov ? `?prov=${prov}` : ""}`} className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> Nueva OC
          </Link>
        ) : undefined}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Por pagar" value={porPagar.length} tone={porPagar.length ? "red" : "green"} hint={fmtTotales(totalesPorMoneda(conMoneda(porPagar)))} />
        <StatCard label="Urgentes" value={urgentes.length} tone={urgentes.length ? "red" : "default"} hint={`${sinLiberar.length} con la carga sin liberar`} />
        <StatCard label={comprador ? "Comprobantes por descargar" : "Pagados, compras no ha descargado"} value={pagadosSinBajar.length} tone={pagadosSinBajar.length && comprador ? "amber" : "default"} />
        <StatCard label="Pagado este mes" value={pagadosMes.length} tone="green" hint={fmtTotales(totalesPorMoneda(pagadosMes.map((p) => ({ monto: p.pago_monto ?? p.monto, moneda: ocMap.get(p.oc_id)?.moneda ?? "USD" }))))} />
      </div>
      {vencidos.length > 0 && (
        <Card className="border-red-200 bg-red-50 p-3 text-sm text-red-800">{vencidos.length} pago(s) con fecha límite vencida y sin pagar.</Card>
      )}
      {comprador && <ProveedoresPagos proveedores={provList} />}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {(Object.keys(VISTAS) as Vista[]).map((k) => (
          <FilterChip key={k} href={href({ ver: k })} active={ver === k}>
            {VISTAS[k]}
            {k === "por_pagar" && porPagar.length ? ` ${porPagar.length}` : k === "comprobantes" && pagadosSinBajar.length ? ` ${pagadosSinBajar.length}` : ""}
          </FilterChip>
        ))}
      </div>
      {enPagos.length > 1 && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 text-xs sm:mx-0 sm:flex-wrap sm:px-0">
          <Link href={href({ prov: undefined })} className={`shrink-0 rounded-full border px-3 py-1 ${!prov ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}>Todos los proveedores</Link>
          {enPagos.map((s) => (
            <Link key={s.id} href={href({ prov: s.id })} className={`shrink-0 rounded-full border px-3 py-1 ${prov === s.id ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{s.nombre}</Link>
          ))}
        </div>
      )}

      {grupos.length === 0 ? (
        <Card className="p-0">
          <EmptyState title={enPagos.length === 0 ? "Aún no hay proveedores en pagos" : ver === "por_pagar" ? "No hay pagos pendientes" : "Nada en esta vista"}>
            {enPagos.length === 0 && (comprador ? "Agrega tus proveedores extranjeros con \"Agregar o quitar\"." : "Compras todavía no agrega proveedores.")}
          </EmptyState>
        </Card>
      ) : (
        grupos.map(({ s, pagos: l, sinPagos }) => {
          const pend = l.filter((p) => p.estado !== "cerrado" && p.estado !== "pagado");
          return (
            <Card key={s.id} className="overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <p className="font-semibold text-slate-900">{s.nombre} {s.pais && <span className="text-xs font-normal text-slate-500">{s.pais}</span>}</p>
                {pend.length > 0 && <p className="text-xs text-slate-600">Pendiente: <strong>{fmtTotales(totalesPorMoneda(conMoneda(pend)))}</strong></p>}
              </div>
              <ul className="divide-y divide-slate-100">
                {l.map((p) => {
                  const oc = ocMap.get(p.oc_id)!;
                  const st = ESTADO_PAGO[p.estado];
                  const venc = pagoVencido(p, today);
                  return (
                    <li key={p.id}>
                      <Link href={`/pagos/oc/${p.oc_id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 text-sm">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-slate-500">OC {oc.numero}</span>
                            <span className="font-medium text-slate-900">{TIPO_PAGO[p.tipo]} {p.numero_factura ?? <span className="font-normal text-amber-700">sin número</span>}</span>
                            <span className="font-semibold">{fmtMonto(ver === "historial" ? p.pago_monto ?? p.monto : netoPago(p), oc.moneda)}</span>
                          </p>
                          <p className="text-xs text-slate-500">
                            {p.estado === "pagado" || p.estado === "cerrado"
                              ? `Pagado el ${fecha(p.pago_fecha)}${p.pago_referencia ? ` · Ref. ${p.pago_referencia}` : ""}${p.comprobante_path ? "" : " · sin comprobante"}`
                              : [p.fecha_limite && `Pagar antes del ${fecha(p.fecha_limite)}`].filter(Boolean).join(" · ") || st.hint}
                          </p>
                          {p.estado === "pendiente" && p.estado_nota && <p className="text-xs font-medium text-amber-900">Compras: {p.estado_nota}</p>}
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1.5">
                          {p.estado === "pendiente" && p.urgente && <Chip cls="bg-red-600 text-white">URGENTE</Chip>}
                          {venc && <Chip cls="bg-red-600 text-white">Vencido</Chip>}
                          <Chip cls={CARGA[p.carga].cls}>{CARGA[p.carga].label}</Chip>
                          <Chip cls={st.cls}>{st.label}</Chip>
                        </div>
                      </Link>
                    </li>
                  );
                })}
                {sinPagos.map((o) => (
                  <li key={o.id}>
                    <Link href={`/pagos/oc/${o.id}`} className="flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-slate-50">
                      <span><span className="font-mono text-xs text-slate-500">OC {o.numero}</span> <span className="text-slate-600">{o.monto ? fmtMonto(o.monto, o.moneda) : ""}</span></span>
                      <Chip cls="bg-slate-100 text-slate-600">Sin facturas todavía</Chip>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })
      )}
    </div>
  );
}
