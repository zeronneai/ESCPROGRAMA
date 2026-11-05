import Link from "next/link";
import { DateTime } from "luxon";
import { BitacoraList, type BitacoraListRow } from "@/components/bitacora-list";
import { Icon } from "@/components/icons";
import { VentasList, type VentaListRow } from "@/components/ventas-list";
import { Card, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { PROSPECT_GROUPS, prospectGroup } from "@/lib/bitacora/stages";
import { BITACORA_SELECT } from "@/lib/bitacora/queries";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { cobroEstado, money, saldo, VENTA_COLS } from "@/lib/ventas";

const VENTA_VIEWS = { hoy: "Hoy", semana: "Esta semana", mes: "Este mes", por_cobrar: "Por cobrar", vencidas: "Vencidas", por_entregar: "Por entregar", visitas: "Visitas sin venta", todas: "Todas" } as const;
type VentaView = keyof typeof VENTA_VIEWS;

export default async function Bitacora({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab === "prospeccion" ? "prospeccion" : "ventas";
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const now = DateTime.now().setZone(cfg.timezone);
  const today = now.toISODate()!;
  const monthStart = now.startOf("month").toISODate()!;
  const weekStart = now.startOf("week").toISODate()!;

  const [ventasQ, bitQ, { count: movHoy }, { count: convertidos }] = await Promise.all([
    supabase.from("ventas").select(`${VENTA_COLS}, customers(nombre), venta_lineas(descripcion, cantidad)`).eq("vendedor_id", user.id).order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(1000),
    supabase.from("bitacora").select(BITACORA_SELECT).order("updated_at", { ascending: false }).limit(1500),
    supabase.from("bitacora_eventos").select("id", { count: "exact", head: true }).eq("created_by", user.id).gte("created_at", now.startOf("day").toUTC().toISO()!),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("convertido_por", user.id).gte("convertido_at", now.startOf("month").toUTC().toISO()!),
  ]);
  const error = ventasQ.error ?? bitQ.error;
  const ventas = (ventasQ.data ?? []) as unknown as VentaListRow[];
  const vivas = ventas.filter((v) => !v.cancelada_at && v.tipo !== "visita");
  const visitas = ventas.filter((v) => !v.cancelada_at && v.tipo === "visita");
  const allBit = ((bitQ.data ?? []) as unknown as BitacoraListRow[]).filter((r) => !r.archived_at);
  const unassigned = allBit.filter((r) => !r.vendedor_id);
  const prospectos = allBit.filter((r) => r.vendedor_id === user.id);

  const hoy = vivas.filter((v) => v.fecha === today);
  const mes = vivas.filter((v) => v.fecha >= monthStart);
  const sum = (l: VentaListRow[]) => l.filter((v) => v.moneda === "MXN").reduce((a, v) => a + Number(v.monto ?? 0), 0);
  const porCobrar = vivas.filter((v) => cobroEstado(v, today) === "por_cobrar");
  const vencidas = vivas.filter((v) => cobroEstado(v, today) === "vencida");
  const porEntregar = vivas.filter((v) => !v.entregado);
  const ventasHoyMov = hoy.length + (movHoy ?? 0);

  // Ventas: filtro
  const vv = (sp.ver && sp.ver in VENTA_VIEWS ? sp.ver : "mes") as VentaView;
  const ventaRows =
    vv === "hoy" ? ventas.filter((v) => v.fecha === today)
    : vv === "semana" ? ventas.filter((v) => v.fecha >= weekStart)
    : vv === "mes" ? ventas.filter((v) => v.fecha >= monthStart)
    : vv === "por_cobrar" ? porCobrar
    : vv === "vencidas" ? vencidas
    : vv === "por_entregar" ? porEntregar
    : vv === "visitas" ? visitas
    : ventas;

  // Prospeccion: filtro
  const grupo = sp.grupo ?? "";
  const buscar = (sp.buscar ?? "").trim().toLowerCase();
  const abiertos = prospectos.filter((r) => r.resultado === "abierta");
  const seguimientos = abiertos.filter((r) => r.proximo_seguimiento && r.proximo_seguimiento <= today).length;
  const prospRows = prospectos
    .filter((r) => {
      if (grupo === "seguimiento") return r.resultado === "abierta" && !!r.proximo_seguimiento && r.proximo_seguimiento <= today;
      if (grupo === "cerrados") return r.resultado !== "abierta";
      if (grupo) return r.resultado === "abierta" && prospectGroup(r) === grupo;
      return true;
    })
    .filter((r) => !buscar || [r.customers?.nombre, r.necesidad, r.customers?.giro, r.customers?.estado_geo, r.comentarios].some((f) => f?.toLowerCase().includes(buscar)))
    .sort((a, b) => Number(a.resultado !== "abierta") - Number(b.resultado !== "abierta") || b.updated_at.localeCompare(a.updated_at));
  const phref = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ tab: "prospeccion" });
    for (const [k, v] of Object.entries({ grupo: grupo || undefined, buscar: sp.buscar, ...o })) if (v) p.set(k, v);
    return `/vendedor/bitacora?${p}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bitácora"
        subtitle={tab === "ventas" ? "Ventas diarias: registra cada venta a tus clientes. Formato ESC-VEN-FR-002." : "Prospección: seguimiento por etapas de empresas que aún no nos compran."}
        actions={
          tab === "ventas" ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/vendedor/bitacora/venta/nueva?tipo=visita" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Visita sin venta
              </Link>
              <Link href="/vendedor/bitacora/venta/nueva" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Venta sin factura
              </Link>
              <Link href="/vendedor/bitacora/venta/factura" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
                <Icon name="plus" className="h-4 w-4" /> Registrar venta con factura
              </Link>
            </div>
          ) : (
            <Link href="/vendedor/bitacora/nuevo?tipo=prospecto" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
              <Icon name="plus" className="h-4 w-4" /> Nuevo prospecto
            </Link>
          )
        }
      />
      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudo cargar la bitácora: {error.message}</Card>}

      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium sm:inline-grid">
        <Link href="/vendedor/bitacora" className={`whitespace-nowrap rounded-md px-5 py-2.5 text-center ${tab === "ventas" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
          Ventas diarias <span className="text-slate-400">{hoy.length ? `${hoy.length} hoy` : ""}</span>
        </Link>
        <Link href="/vendedor/bitacora?tab=prospeccion" className={`whitespace-nowrap rounded-md px-5 py-2.5 text-center ${tab === "prospeccion" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
          Prospección <span className="text-slate-400">{abiertos.length}</span>
        </Link>
      </div>

      {tab === "ventas" ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Ventas hoy" value={hoy.length} tone={ventasHoyMov ? "green" : "amber"} hint={hoy.length ? money(sum(hoy)) : "Aún no registras ventas hoy"} />
            <StatCard label="Ventas del mes" value={mes.length} hint={`${money(sum(mes))} · ${visitas.filter((v) => v.fecha >= monthStart).length} visita(s) sin venta`} />
            <StatCard label="Por cobrar" value={money(porCobrar.reduce((a, v) => a + saldo(v), 0))} hint={`${porCobrar.length} venta(s)`} />
            <StatCard label="Cartera vencida" value={money(vencidas.reduce((a, v) => a + saldo(v), 0))} tone={vencidas.length ? "red" : "default"} hint={`${vencidas.length} venta(s)`} />
            <StatCard label="Por entregar" value={porEntregar.length} tone={porEntregar.length ? "amber" : "default"} />
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {(Object.keys(VENTA_VIEWS) as VentaView[]).map((k) => (
              <FilterChip key={k} href={k === "mes" ? "/vendedor/bitacora" : `/vendedor/bitacora?ver=${k}`} active={vv === k}>
                {VENTA_VIEWS[k]}
                {k === "vencidas" && vencidas.length ? ` ${vencidas.length}` : k === "visitas" && visitas.length ? ` ${visitas.length}` : k === "por_entregar" && porEntregar.length ? ` ${porEntregar.length}` : ""}
              </FilterChip>
            ))}
          </div>
          <Card className="overflow-hidden p-0">
            <VentasList rows={ventaRows} today={today} basePath="/vendedor/bitacora/venta" editable />
          </Card>
        </>
      ) : (
        <>
          {unassigned.length > 0 && (
            <Link href={`/vendedor/bitacora/${unassigned[0].id}`} className="flex items-center justify-between gap-3 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900 hover:bg-brand-100">
              <span>Hay <strong>{unassigned.length}</strong> prospecto(s) del sitio web sin vendedor. Tómalo antes que alguien más.</span>
              <span className="shrink-0 font-medium underline">Ver</span>
            </Link>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Prospectos activos" value={abiertos.length} />
            <StatCard label="Seguimiento pendiente" value={seguimientos} tone={seguimientos ? "amber" : "default"} hint="Hoy o atrasado" />
            <StatCard label="Movimientos hoy" value={movHoy ?? 0} tone={(movHoy ?? 0) > 0 ? "green" : "default"} />
            <StatCard label="Se volvieron clientes" value={convertidos ?? 0} tone={(convertidos ?? 0) > 0 ? "green" : "default"} hint="Este mes" />
          </div>
          <Card className="space-y-3 p-4">
            {abiertos.length > 0 && (
              <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                {PROSPECT_GROUPS.map((g) => {
                  const n = abiertos.filter((r) => prospectGroup(r) === g.id).length;
                  return n ? <div key={g.id} className={g.color} style={{ width: `${(n / abiertos.length) * 100}%` }} /> : null;
                })}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PROSPECT_GROUPS.map((g) => {
                const n = abiertos.filter((r) => prospectGroup(r) === g.id).length;
                return (
                  <Link key={g.id} href={phref({ grupo: grupo === g.id ? undefined : g.id })} className={`rounded-lg border p-2.5 ${grupo === g.id ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200 hover:border-slate-400"}`}>
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><span className={`h-2.5 w-2.5 rounded-full ${g.color}`} />{g.label}</span>
                    <span className="mt-0.5 block text-xl font-semibold tabular-nums">{n}</span>
                  </Link>
                );
              })}
            </div>
          </Card>
          <form method="get" className="flex gap-2">
            <input type="hidden" name="tab" value="prospeccion" />
            <input name="buscar" defaultValue={sp.buscar ?? ""} placeholder="Buscar prospecto, necesidad, giro o estado" className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
            <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Buscar</button>
          </form>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            <FilterChip href={phref({ grupo: undefined })} active={!grupo}>Todos {prospectos.length}</FilterChip>
            <FilterChip href={phref({ grupo: "seguimiento" })} active={grupo === "seguimiento"}>Seguimiento pendiente {seguimientos}</FilterChip>
            <FilterChip href={phref({ grupo: "cerrados" })} active={grupo === "cerrados"}>Cerrados {prospectos.length - abiertos.length}</FilterChip>
          </div>
          <Card className="p-0">
            <BitacoraList rows={prospRows} hrefFor={(id) => `/vendedor/bitacora/${id}`} today={today} />
          </Card>
        </>
      )}
    </div>
  );
}
