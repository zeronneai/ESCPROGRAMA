import Link from "next/link";
import { DateTime } from "luxon";
import { Icon } from "@/components/icons";
import { FollowUpBadge, PriorityBadge, StageBadge } from "@/components/lead-badges";
import { MonthlyChart, SourceChart, StageChart, WeeklyActivityChart } from "@/components/leads-charts";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { relativeDays } from "@/lib/leads/format";
import { computeLeadStats } from "@/lib/leads/stats";
import { OPEN_STAGES, SOURCE_LABEL, STAGE_SHORT, isClosed, whatsappNumber, type LeadActivityRow, type LeadRow, type LeadStage } from "@/lib/leads/types";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

const VISTAS = [
  ["activos", "Activos"],
  ...OPEN_STAGES.map((s) => [s, STAGE_SHORT[s]] as const),
  ["ganado", "Ganados"],
  ["perdido", "Perdidos"],
  ["seguimiento", "Seguimiento pendiente"],
  ["sin_asignar", "Sin asignar"],
  ["archivados", "Archivados"],
] as const;
type Vista = (typeof VISTAS)[number][0];

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab === "graficas" ? "graficas" : "lista";
  const vista = (VISTAS.find(([v]) => v === sp.vista)?.[0] ?? "activos") as Vista;
  const buscar = (sp.buscar ?? "").trim().toLowerCase();

  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const now = new Date();
  const since = DateTime.now().setZone(cfg.timezone).startOf("month").minus({ months: 6 }).toUTC().toISO()!;
  const [{ data: leadsData, error }, { data: actsData }] = await Promise.all([
    supabase.from("leads").select("*").order("updated_at", { ascending: false }).limit(3000),
    supabase.from("lead_activities").select("tipo, created_at, etapa_despues").eq("created_by", user.id).gte("created_at", since).limit(10000),
  ]);
  const all = (leadsData ?? []) as LeadRow[];
  const mine = all.filter((l) => l.vendedor_id === user.id);
  const unassigned = all.filter((l) => l.vendedor_id === null && !l.archived_at);
  const stats = computeLeadStats(mine, (actsData ?? []) as Pick<LeadActivityRow, "tipo" | "created_at" | "etapa_despues">[], now, cfg.timezone);
  const today = DateTime.now().setZone(cfg.timezone).toISODate()!;

  const belongs = (l: LeadRow, v: Vista): boolean => {
    if (v === "sin_asignar") return l.vendedor_id === null && !l.archived_at;
    if (l.vendedor_id !== user.id) return false;
    if (v === "archivados") return !!l.archived_at;
    if (l.archived_at) return false;
    if (v === "activos") return !isClosed(l.etapa);
    if (v === "seguimiento") return !isClosed(l.etapa) && !!l.proximo_seguimiento && l.proximo_seguimiento <= today;
    return l.etapa === (v as LeadStage);
  };
  const matches = (l: LeadRow) =>
    !buscar ||
    [l.empresa, l.contacto_nombre, l.producto_interes, l.ciudad, l.telefono, l.correo, l.industria].some((f) => f?.toLowerCase().includes(buscar));
  const rows = all
    .filter((l) => belongs(l, vista) && matches(l))
    .sort((a, b) => {
      // Primero lo que tiene seguimiento (mas antiguo primero), luego lo mas reciente.
      const fa = a.proximo_seguimiento ?? "9999";
      const fb = b.proximo_seguimiento ?? "9999";
      return fa.localeCompare(fb) || b.updated_at.localeCompare(a.updated_at);
    });
  const countFor = (v: Vista) => all.filter((l) => belongs(l, v)).length;

  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { tab: tab === "lista" ? undefined : tab, vista: vista === "activos" ? undefined : vista, buscar: sp.buscar, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/vendedor/leads${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads"
        subtitle="Tus prospectos: a quién contactaste, qué le interesa y en qué etapa va."
        actions={
          <Link
            href="/vendedor/leads/nuevo"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Icon name="plus" className="h-4 w-4" />
            Nuevo lead
          </Link>
        }
      />

      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudieron cargar los leads: {error.message}</Card>}

      {unassigned.length > 0 && vista !== "sin_asignar" && (
        <Link
          href={href({ vista: "sin_asignar", tab: undefined })}
          className="flex items-center justify-between gap-3 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900 hover:bg-brand-100"
        >
          <span>
            Hay <strong>{unassigned.length}</strong> lead(s) sin asignar (por ejemplo del sitio web). Tómalos antes que alguien más.
          </span>
          <span className="shrink-0 font-medium underline">Ver</span>
        </Link>
      )}
      {stats.seguimientosVencidos + stats.seguimientosHoy > 0 && vista !== "seguimiento" && (
        <Link
          href={href({ vista: "seguimiento", tab: undefined })}
          className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          <span>
            Tienes <strong>{stats.seguimientosHoy}</strong> seguimiento(s) para hoy
            {stats.seguimientosVencidos > 0 && (
              <>
                {" "}y <strong>{stats.seguimientosVencidos}</strong> vencido(s)
              </>
            )}
            .
          </span>
          <span className="shrink-0 font-medium underline">Ver</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Prospectos activos" value={stats.activos} tone="brand" hint={`${stats.sinContactar} sin contactar`} />
        <StatCard label="Nuevos este mes" value={stats.nuevosMes} />
        <StatCard
          label="Contactos este mes"
          value={stats.contactosMes.total}
          hint={`${stats.contactosMes.llamadas} llamadas · ${stats.contactosMes.mensajes} WhatsApp · ${stats.contactosMes.correos} correos`}
        />
        <StatCard label="Ya son clientes" value={stats.ganados} tone={stats.ganados > 0 ? "green" : "default"} hint={`${stats.ganadosMes} este mes`} />
        <StatCard label="Conversión" value={pct(stats.tasaConversion)} hint={`${stats.ganados} ganados · ${stats.perdidos} perdidos`} />
        <StatCard
          label="Valor en proceso"
          value={stats.pipeline.length ? `$${Math.round(stats.pipeline[0].valor).toLocaleString("es-MX")}` : "-"}
          hint={stats.pipeline.length ? stats.pipeline.map((p) => `${p.moneda} (${p.leads} leads)`).join(" · ") : "Captura el valor estimado"}
        />
      </div>

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium sm:inline-flex">
        <Link
          href={href({ tab: undefined })}
          className={`flex-1 rounded-md px-4 py-1.5 text-center ${tab === "lista" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
        >
          Lista
        </Link>
        <Link
          href={href({ tab: "graficas" })}
          className={`flex-1 rounded-md px-4 py-1.5 text-center ${tab === "graficas" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
        >
          Gráficas
        </Link>
      </div>

      {tab === "graficas" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <StageChart data={stats.porEtapa} />
          <WeeklyActivityChart data={stats.actividadSemanal} />
          <MonthlyChart data={stats.porMes} />
          <SourceChart data={stats.porOrigen} />
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <form method="get" className="flex gap-2">
              {vista !== "activos" && <input type="hidden" name="vista" value={vista} />}
              <input
                name="buscar"
                defaultValue={sp.buscar ?? ""}
                placeholder="Buscar empresa, contacto, producto o ciudad"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
              />
              <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Buscar</button>
            </form>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
              {VISTAS.map(([v, l]) => {
                const n = countFor(v);
                if (n === 0 && v !== "activos" && v !== vista && (v === "sin_asignar" || v === "archivados" || v === "seguimiento")) return null;
                return (
                  <FilterChip key={v} href={href({ vista: v === "activos" ? undefined : v })} active={vista === v}>
                    {l}
                    <span className={vista === v ? "text-white/80" : "text-slate-400"}>{n}</span>
                  </FilterChip>
                );
              })}
            </div>
          </div>

          <Card className="p-0">
            {rows.length === 0 ? (
              <EmptyState
                title={mine.length === 0 ? "Aún no tienes leads" : "No hay leads en esta vista"}
                action={
                  mine.length === 0 ? (
                    <Link href="/vendedor/leads/nuevo" className="text-sm font-medium text-brand-600 hover:underline">
                      Registrar el primero
                    </Link>
                  ) : undefined
                }
              >
                {mine.length === 0 ? "Registra a cada prospecto que llames o te escriba para ver tu embudo." : undefined}
              </EmptyState>
            ) : (
              <>
                <table className="hidden w-full text-left text-sm md:table">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Prospecto</th>
                      <th className="px-4 py-2.5 font-medium">Le interesa</th>
                      <th className="px-4 py-2.5 font-medium">Etapa</th>
                      <th className="px-4 py-2.5 font-medium">Último contacto</th>
                      <th className="px-4 py-2.5 font-medium">Seguimiento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((l) => (
                      <tr key={l.id} className="align-top hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link href={`/vendedor/leads/${l.id}`} className="font-medium text-brand-600 hover:underline">
                            {l.empresa}
                          </Link>
                          <span className="block text-xs text-slate-500">
                            {[l.contacto_nombre, l.ciudad].filter(Boolean).join(" · ") || "Sin contacto"}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            <PriorityBadge prioridad={l.prioridad} />
                            <span className="text-[11px] text-slate-400">{SOURCE_LABEL[l.origen]}</span>
                          </span>
                        </td>
                        <td className="max-w-xs px-4 py-3">
                          <span className="line-clamp-2 text-slate-700">{l.producto_interes ?? <span className="text-slate-400">-</span>}</span>
                        </td>
                        <td className="px-4 py-3">
                          <StageBadge etapa={l.etapa} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{relativeDays(l.ultimo_contacto_at, now, cfg.timezone)}</td>
                        <td className="px-4 py-3">
                          {isClosed(l.etapa) ? <span className="text-xs text-slate-400">-</span> : <FollowUpBadge date={l.proximo_seguimiento} now={now} timezone={cfg.timezone} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul className="divide-y divide-slate-100 md:hidden">
                  {rows.map((l) => {
                    const wa = whatsappNumber(l.telefono);
                    return (
                      <li key={l.id} className="flex items-stretch">
                        <Link href={`/vendedor/leads/${l.id}`} className="min-w-0 flex-1 space-y-1 px-3 py-3 active:bg-slate-50">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-medium text-slate-900">{l.empresa}</p>
                            <PriorityBadge prioridad={l.prioridad} />
                          </div>
                          {l.producto_interes && <p className="truncate text-xs text-slate-600">{l.producto_interes}</p>}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StageBadge etapa={l.etapa} />
                            {!isClosed(l.etapa) && <FollowUpBadge date={l.proximo_seguimiento} now={now} timezone={cfg.timezone} />}
                            <span className="text-[11px] text-slate-400">Contacto: {relativeDays(l.ultimo_contacto_at, now, cfg.timezone).toLowerCase()}</span>
                          </div>
                        </Link>
                        {(l.telefono || wa) && (
                          <div className="flex flex-col justify-center gap-1 pr-3">
                            {l.telefono && (
                              <a href={`tel:${l.telefono.replace(/[^\d+]/g, "")}`} className="rounded-full p-2 text-brand-600 hover:bg-brand-50" aria-label={`Llamar a ${l.empresa}`}>
                                <Icon name="phone" className="h-5 w-5" />
                              </a>
                            )}
                            {wa && (
                              <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="rounded-full p-2 text-green-600 hover:bg-green-50" aria-label={`WhatsApp a ${l.empresa}`}>
                                <Icon name="chat" className="h-5 w-5" />
                              </a>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
