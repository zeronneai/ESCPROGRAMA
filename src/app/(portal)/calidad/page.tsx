import Link from "next/link";
import { Icon } from "@/components/icons";
import { Chip } from "@/components/ops-ui";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { FUENTES, QUEJA_ESTADOS, SAC_ESTADOS, VIAS, type Fuente, type QuejaEstado, type SacEstado, type Via } from "@/lib/ops/calidad";
import { fmtDay } from "@/lib/ops/server";
import { createClient } from "@/lib/supabase/server";

export default async function Calidad({ searchParams }: { searchParams: Promise<{ tab?: string; ver?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab === "sac" ? "sac" : "quejas";
  const ver = sp.ver === "cerradas" ? "cerradas" : sp.ver === "todas" ? "todas" : "abiertas";
  const supabase = await createClient();
  const [{ data: qs }, { data: sacs }] = await Promise.all([
    supabase.from("quejas").select("id, numero, fecha_recepcion, via_recepcion, cliente_nombre, descripcion, estado, responsable_nombre, referencia, created_at").order("created_at", { ascending: false }).limit(500),
    supabase.from("acciones_correctivas").select("id, numero, fecha, fuente, descripcion, estado, solicitante, plan, quejas(numero, cliente_nombre)").order("created_at", { ascending: false }).limit(500),
  ]);
  const quejas = (qs ?? []) as { id: string; numero: string; fecha_recepcion: string; via_recepcion: Via; cliente_nombre: string; descripcion: string; estado: QuejaEstado; responsable_nombre: string | null; referencia: string | null }[];
  const acciones = (sacs ?? []) as unknown as { id: string; numero: string; fecha: string; fuente: Fuente; descripcion: string; estado: SacEstado; solicitante: string; plan: { hecho: boolean }[]; quejas: { numero: string; cliente_nombre: string } | null }[];
  const iso = u.rol === "coordinador_iso";
  const canQueja = iso || u.rol === "vendedor";
  const closedQ = (e: QuejaEstado) => e === "cerrada";
  const closedS = (e: SacEstado) => e === "cerrada" || e === "cancelada";
  const qRows = quejas.filter((q) => (ver === "todas" ? true : ver === "cerradas" ? closedQ(q.estado) : !closedQ(q.estado)));
  const sRows = acciones.filter((s) => (ver === "todas" ? true : ver === "cerradas" ? closedS(s.estado) : !closedS(s.estado)));
  const base = (t: string, v?: string) => `/calidad?${new URLSearchParams({ ...(t === "sac" ? { tab: "sac" } : {}), ...(v ? { ver: v } : {}) })}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title={u.rol === "vendedor" ? "Quejas de cliente" : "Quejas y acciones correctivas"}
        subtitle="Formatos ESC-SGC-FR-002 (queja de cliente) y ESC-SGC-FR-001 (solicitud de acción correctiva)."
        actions={
          <div className="flex flex-wrap gap-2">
            {(iso || u.rol === "gerente" || u.rol === "ceo" || u.rol === "comprador") && (
              <Link href="/calidad/cambios" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Control de cambios
              </Link>
            )}
            {iso && (
              <Link href="/documentos" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Documentos
              </Link>
            )}
            {canQueja && (
              <Link href="/calidad/quejas/nueva" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
                <Icon name="plus" className="h-4 w-4" /> Nueva queja
              </Link>
            )}
            {iso && (
              <Link href="/calidad/sac/nueva" className="inline-flex items-center gap-1.5 rounded-md bg-purple-700 px-3 py-2 text-sm font-medium text-white hover:bg-purple-800">
                <Icon name="plus" className="h-4 w-4" /> Acción correctiva
              </Link>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Quejas abiertas" value={quejas.filter((q) => q.estado === "abierta").length} tone={quejas.some((q) => q.estado === "abierta") ? "amber" : "default"} />
        <StatCard label="En análisis o con AC" value={quejas.filter((q) => q.estado === "en_analisis" || q.estado === "con_sac").length} />
        <StatCard label="Acciones correctivas abiertas" value={acciones.filter((s) => !closedS(s.estado)).length} />
        <StatCard label="Quejas cerradas" value={quejas.filter((q) => q.estado === "cerrada").length} tone="green" />
      </div>
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium sm:inline-flex">
        <Link href={base("quejas")} className={`flex-1 whitespace-nowrap rounded-md px-4 py-2 text-center ${tab === "quejas" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>Quejas <span className="text-slate-400">{quejas.length}</span></Link>
        <Link href={base("sac")} className={`flex-1 whitespace-nowrap rounded-md px-4 py-2 text-center ${tab === "sac" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>Acciones correctivas <span className="text-slate-400">{acciones.length}</span></Link>
      </div>
      <div className="flex gap-2">
        <FilterChip href={base(tab)} active={ver === "abiertas"}>Abiertas</FilterChip>
        <FilterChip href={base(tab, "cerradas")} active={ver === "cerradas"}>Cerradas</FilterChip>
        <FilterChip href={base(tab, "todas")} active={ver === "todas"}>Todas</FilterChip>
      </div>
      <Card className="p-0">
        {tab === "quejas" ? (
          qRows.length === 0 ? <EmptyState title="Sin quejas en esta vista" /> : (
            <ul className="divide-y divide-slate-100">
              {qRows.map((q) => (
                <li key={q.id}>
                  <Link href={`/calidad/quejas/${q.id}`} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{q.numero} · {q.cliente_nombre}</p>
                      <p className="truncate text-sm text-slate-600">{q.descripcion}</p>
                      <p className="text-xs text-slate-500">{fmtDay(q.fecha_recepcion)} · {VIAS[q.via_recepcion]}{q.responsable_nombre && ` · Recibió ${q.responsable_nombre}`}{q.referencia && ` · ${q.referencia}`}</p>
                    </div>
                    <Chip cls={QUEJA_ESTADOS[q.estado].chip}>{QUEJA_ESTADOS[q.estado].label}</Chip>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : sRows.length === 0 ? (
          <EmptyState title="Sin acciones correctivas en esta vista">{u.rol === "vendedor" && "Aquí ves las acciones correctivas que salgan de tus quejas."}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sRows.map((s) => {
              const done = s.plan.filter((p) => p.hecho).length;
              return (
                <li key={s.id}>
                  <Link href={`/calidad/sac/${s.id}`} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{s.numero}{s.quejas && ` · Queja ${s.quejas.numero} (${s.quejas.cliente_nombre})`}</p>
                      <p className="truncate text-sm text-slate-600">{s.descripcion}</p>
                      <p className="text-xs text-slate-500">{fmtDay(s.fecha)} · {FUENTES[s.fuente]} · {s.solicitante}{s.plan.length > 0 && ` · Plan ${done}/${s.plan.length}`}</p>
                    </div>
                    <Chip cls={SAC_ESTADOS[s.estado].chip}>{SAC_ESTADOS[s.estado].label}</Chip>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
