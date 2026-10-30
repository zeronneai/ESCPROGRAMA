import Link from "next/link";
import { DateTime } from "luxon";
import { BitacoraList, type BitacoraListRow } from "@/components/bitacora-list";
import { Icon } from "@/components/icons";
import { Card, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { PROSPECT_GROUPS, prospectGroup, SALES_GROUPS, salesGroup } from "@/lib/bitacora/stages";
import { BITACORA_SELECT } from "@/lib/bitacora/queries";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function Bitacora({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab === "prospeccion" ? "prospeccion" : "ventas";
  const grupo = sp.grupo ?? "";
  const buscar = (sp.buscar ?? "").trim().toLowerCase();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const now = DateTime.now().setZone(cfg.timezone);
  const today = now.toISODate()!;
  const monthStart = now.startOf("month");

  const [{ data, error }, { count: hoy }, { count: convertidos }] = await Promise.all([
    supabase.from("bitacora").select(BITACORA_SELECT).order("updated_at", { ascending: false }).limit(1500),
    supabase.from("bitacora_eventos").select("id", { count: "exact", head: true }).eq("created_by", user.id).gte("created_at", now.startOf("day").toUTC().toISO()!),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("convertido_por", user.id).gte("convertido_at", monthStart.toUTC().toISO()!),
  ]);
  const all = ((data ?? []) as unknown as BitacoraListRow[]).filter((r) => !r.archived_at);
  const unassigned = all.filter((r) => !r.vendedor_id);
  const mine = all.filter((r) => r.vendedor_id === user.id);
  const ventas = mine.filter((r) => r.customers?.tipo === "cliente");
  const prospeccion = mine.filter((r) => r.customers?.tipo !== "cliente");
  const base = tab === "ventas" ? ventas : prospeccion;
  const groupOf = (r: BitacoraListRow) => (tab === "ventas" ? salesGroup(r) : prospectGroup(r));
  const groups = tab === "ventas" ? SALES_GROUPS : PROSPECT_GROUPS;
  const abiertos = base.filter((r) => r.resultado === "abierta");
  const rows = base
    .filter((r) => {
      if (grupo === "seguimiento") return r.resultado === "abierta" && !!r.proximo_seguimiento && r.proximo_seguimiento <= today;
      if (grupo === "cerrados") return r.resultado !== "abierta";
      if (grupo) return r.resultado === "abierta" && groupOf(r) === grupo;
      return true;
    })
    .filter((r) => !buscar || [r.customers?.nombre, r.necesidad, r.customers?.giro, r.customers?.estado_geo, r.comentarios].some((f) => f?.toLowerCase().includes(buscar)))
    .sort((a, b) => Number(a.resultado !== "abierta") - Number(b.resultado !== "abierta") || b.updated_at.localeCompare(a.updated_at));

  const pedidosMes = ventas.filter((r) => r.fecha_pedido && r.fecha_pedido >= monthStart.toISODate()!);
  const ventaMes = pedidosMes.reduce((a, r) => a + (r.moneda === "MXN" ? Number(r.monto_venta ?? 0) : 0), 0);
  const cartera = ventas.reduce((a, r) => a + (Number(r.cartera_dias_vencidos ?? 0) > 0 ? Number(r.cartera_monto ?? 0) : 0), 0);
  const seguimientos = base.filter((r) => r.resultado === "abierta" && r.proximo_seguimiento && r.proximo_seguimiento <= today).length;
  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const m = { tab: tab === "ventas" ? undefined : tab, grupo: grupo || undefined, buscar: sp.buscar, ...o };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    const s = p.toString();
    return `/vendedor/bitacora${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bitácora de ventas / Prospección"
        subtitle="Formato ESC-VEN-FR-002. Registra cada día qué vendes y en qué etapa va."
        actions={
          <Link href={`/vendedor/bitacora/nuevo?tipo=${tab === "ventas" ? "cliente" : "prospecto"}`} className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> Nuevo registro
          </Link>
        }
      />
      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudo cargar la bitácora: {error.message}</Card>}

      {unassigned.length > 0 && (
        <Link href={`/vendedor/bitacora/${unassigned[0].id}`} className="flex items-center justify-between gap-3 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900 hover:bg-brand-100">
          <span>Hay <strong>{unassigned.length}</strong> prospecto(s) del sitio web sin vendedor. Tómalo antes que alguien más.</span>
          <span className="shrink-0 font-medium underline">Ver</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Movimientos hoy" value={hoy ?? 0} tone={(hoy ?? 0) > 0 ? "green" : "amber"} hint={(hoy ?? 0) === 0 ? "Aún no registras avance hoy" : "Avances y comentarios"} />
        <StatCard label="Ventas en curso" value={ventas.filter((r) => r.resultado === "abierta").length} hint="Registros de clientes" />
        <StatCard label="Prospectos activos" value={prospeccion.filter((r) => r.resultado === "abierta").length} />
        <StatCard label="Prospectos que se volvieron clientes" value={convertidos ?? 0} tone={(convertidos ?? 0) > 0 ? "green" : "default"} hint="Este mes" />
        <StatCard label="Pedidos este mes" value={pedidosMes.length} hint={ventaMes ? `$${Math.round(ventaMes).toLocaleString("es-MX")} MXN` : undefined} />
        <StatCard label="Cartera vencida" value={cartera ? `$${Math.round(cartera).toLocaleString("es-MX")}` : "$0"} tone={cartera > 0 ? "red" : "default"} />
      </div>

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium sm:inline-flex">
        <Link href={`/vendedor/bitacora${sp.buscar ? `?buscar=${encodeURIComponent(sp.buscar)}` : ""}`} className={`flex-1 whitespace-nowrap rounded-md px-4 py-2 text-center ${tab === "ventas" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
          Ventas diarias <span className="text-slate-400">{ventas.length}</span>
        </Link>
        <Link href={`/vendedor/bitacora?tab=prospeccion${sp.buscar ? `&buscar=${encodeURIComponent(sp.buscar)}` : ""}`} className={`flex-1 whitespace-nowrap rounded-md px-4 py-2 text-center ${tab === "prospeccion" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
          Prospección <span className="text-slate-400">{prospeccion.length}</span>
        </Link>
      </div>
      <p className="-mt-2 text-xs text-slate-500">
        {tab === "ventas" ? "Clientes que ya nos compran: pedidos, facturación, entrega, cobranza y cartera." : "Prospectos: aún no nos compran. Cuando compren, márcalos como cliente y pasan a Ventas."}
      </p>

      <Card className="space-y-3 p-4">
        {abiertos.length > 0 && (
          <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            {groups.map((g) => {
              const n = abiertos.filter((r) => groupOf(r) === g.id).length;
              return n ? <div key={g.id} className={g.color} style={{ width: `${(n / abiertos.length) * 100}%` }} /> : null;
            })}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {groups.map((g) => {
            const n = abiertos.filter((r) => groupOf(r) === g.id).length;
            return (
              <Link key={g.id} href={href({ grupo: grupo === g.id ? undefined : g.id })} className={`rounded-lg border p-2.5 ${grupo === g.id ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200 hover:border-slate-400"}`}>
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><span className={`h-2.5 w-2.5 rounded-full ${g.color}`} />{g.label}</span>
                <span className="mt-0.5 block text-xl font-semibold tabular-nums">{n}</span>
              </Link>
            );
          })}
        </div>
      </Card>

      <form method="get" className="flex gap-2">
        {tab !== "ventas" && <input type="hidden" name="tab" value={tab} />}
        <input name="buscar" defaultValue={sp.buscar ?? ""} placeholder="Buscar cliente, necesidad, giro o estado" className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
        <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Buscar</button>
      </form>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <FilterChip href={href({ grupo: undefined })} active={!grupo}>Todos {base.length}</FilterChip>
        <FilterChip href={href({ grupo: "seguimiento" })} active={grupo === "seguimiento"}>Seguimiento pendiente {seguimientos}</FilterChip>
        <FilterChip href={href({ grupo: "cerrados" })} active={grupo === "cerrados"}>Cerrados {base.length - abiertos.length}</FilterChip>
      </div>

      <Card className="p-0">
        <BitacoraList rows={rows} hrefFor={(id) => `/vendedor/bitacora/${id}`} today={today} />
      </Card>
    </div>
  );
}
