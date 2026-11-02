import Link from "next/link";
import { Icon } from "@/components/icons";
import { Chip } from "@/components/ops-ui";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { CATEGORIAS, CONSUMO_ESTADOS, type Categoria, type ConsumoEstado } from "@/lib/ops/consumo";
import { fmtDay } from "@/lib/ops/server";
import { createClient } from "@/lib/supabase/server";

type Row = {
  id: string; numero: string; solicitante_id: string; solicitante_nombre: string | null; tipo: "producto" | "servicio"; categoria: Categoria;
  descripcion: string; cantidad: number; unidad: string | null; urgente: boolean; estado: ConsumoEstado; fecha_programada: string | null; created_at: string;
};

export default async function Consumo({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const u = await requireUser();
  const { ver: verParam } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consumo_solicitudes")
    .select("id, numero, solicitante_id, solicitante_nombre, tipo, categoria, descripcion, cantidad, unidad, urgente, estado, fecha_programada, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  const all = (data ?? []) as Row[];
  const mine = all.filter((r) => r.solicitante_id === u.id);
  const views: { id: string; label: string; rows: Row[] }[] =
    u.rol === "jefe_ventas"
      ? [
          { id: "por_aprobar", label: "Por aprobar", rows: all.filter((r) => r.estado === "por_aprobar") },
          { id: "abiertas", label: "En curso", rows: all.filter((r) => r.estado === "aprobada" || r.estado === "en_proceso") },
          { id: "todas", label: "Todas", rows: all },
        ]
      : u.rol === "comprador"
        ? [
            { id: "por_atender", label: "Por atender", rows: all.filter((r) => r.estado === "aprobada") },
            { id: "en_proceso", label: "Pedidas / agendadas", rows: all.filter((r) => r.estado === "en_proceso") },
            { id: "todas", label: "Todas", rows: all },
          ]
        : u.rol === "gerente" || u.rol === "coordinador_iso"
          ? [
              { id: "abiertas", label: "En curso", rows: all.filter((r) => ["por_aprobar", "aprobada", "en_proceso"].includes(r.estado)) },
              { id: "mias", label: "Mías", rows: mine },
              { id: "todas", label: "Todas", rows: all },
            ]
          : [
              { id: "abiertas", label: "En curso", rows: mine.filter((r) => ["por_aprobar", "aprobada", "en_proceso"].includes(r.estado)) },
              { id: "todas", label: "Todas mis solicitudes", rows: mine },
            ];
  const view = views.find((v) => v.id === verParam) ?? views[0];
  const rows = [...view.rows].sort((a, b) => Number(b.urgente) - Number(a.urgente) || (view.id === "todas" ? 0 : a.created_at.localeCompare(b.created_at)));
  const count = (s: ConsumoEstado[]) => all.filter((r) => s.includes(r.estado) && (u.rol === "vendedor" || u.rol === "marketplaces" ? r.solicitante_id === u.id : true)).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Consumo interno"
        subtitle={u.rol === "jefe_ventas" ? "Aprueba lo que pide el equipo; lo aprobado le llega al comprador." : u.rol === "comprador" ? "Solicitudes aprobadas por la jefa de ventas. Márcalas pedidas o agendadas y luego recibidas o realizadas." : "Papelería, limpieza, servicios de vehículos y lo del día a día."}
        actions={u.rol !== "comprador" && (
          <Link href="/consumo/nueva" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> Nueva solicitud
          </Link>
        )}
      />
      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudo cargar: {error.message}</Card>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {u.rol !== "comprador" && <StatCard label="Por aprobar" value={count(["por_aprobar"])} tone={count(["por_aprobar"]) && u.rol === "jefe_ventas" ? "amber" : "default"} />}
        <StatCard label="Aprobadas sin atender" value={count(["aprobada"])} tone={count(["aprobada"]) && u.rol === "comprador" ? "amber" : "default"} />
        <StatCard label="Pedidas / agendadas" value={count(["en_proceso"])} />
        <StatCard label="Completadas" value={count(["completada"])} tone="green" />
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {views.map((v) => (
          <FilterChip key={v.id} href={v.id === views[0].id ? "/consumo" : `/consumo?ver=${v.id}`} active={v.id === view.id}>{v.label} {v.rows.length}</FilterChip>
        ))}
      </div>
      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyState title="Nada en esta vista" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/consumo/${r.id}`} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      <span className="truncate">{r.descripcion}</span>
                      {r.urgente && <Chip cls="bg-red-600 text-white">URGENTE</Chip>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.numero} · {Number(r.cantidad).toLocaleString("es-MX")} {r.unidad ?? ""} · {CATEGORIAS[r.categoria]} · {r.tipo === "servicio" ? "Servicio" : "Producto"}
                      {r.solicitante_id !== u.id && ` · ${r.solicitante_nombre}`}
                      {r.fecha_programada && ` · ${r.tipo === "servicio" ? "Agendado" : "Llega"} ${fmtDay(r.fecha_programada)}`}
                    </p>
                  </div>
                  <Chip cls={CONSUMO_ESTADOS[r.estado].chip}>{CONSUMO_ESTADOS[r.estado].label}</Chip>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
