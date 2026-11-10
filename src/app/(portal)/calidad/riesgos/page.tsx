import Link from "next/link";
import { Icon } from "@/components/icons";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { ROL_LABEL } from "@/lib/ops/roles";
import { NIVEL_ROE, normalizar, resumenAnalisis, RIESGO_ROLES, type Actividad } from "@/lib/riesgos";
import { createClient } from "@/lib/supabase/server";
import type { Rol } from "@/lib/auth/route-guard";

type Row = { id: string; folio: string; proceso: string; fecha: string; area: string | null; autor_nombre: string | null; created_by: string; updated_at: string; actividades: Actividad[] };

const dia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

export default async function Riesgos() {
  const u = await requireRoles(RIESGO_ROLES);
  const supabase = await createClient();
  const { data } = await supabase.from("riesgo_analisis").select("id, folio, proceso, fecha, area, autor_nombre, created_by, updated_at, actividades").order("fecha", { ascending: false }).limit(300);
  const rows = (data ?? []) as Row[];
  const todos = ["coordinador_iso", "gerente", "ceo"].includes(u.rol);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Análisis de riesgo"
        subtitle={todos ? "Los análisis de riesgo de todas las áreas (formato de calidad ISO 9001)." : "El análisis de riesgos de tu proceso: qué puede fallar, qué tan grave es y qué se hace para evitarlo."}
        actions={
          <Link href="/calidad/riesgos/nuevo" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> Nuevo análisis
          </Link>
        }
      />
      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyState title="Todavía no hay análisis de riesgo">Empieza con el botón Nuevo análisis. Te guía por etapas.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const s = resumenAnalisis(normalizar(r.actividades));
              return (
                <li key={r.id}>
                  <Link href={`/calidad/riesgos/${r.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900"><span className="mr-2 font-mono text-xs text-slate-500">{r.folio}</span>{r.proceso}</p>
                      <p className="text-xs text-slate-500">
                        {dia(r.fecha)} · {r.autor_nombre}{r.area ? ` (${ROL_LABEL[r.area as Rol] ?? r.area})` : ""} · {(r.actividades ?? []).length} actividad(es), {s.modos} modo(s) de falla
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
                      {s.alto > 0 && <span className={`rounded px-2 py-0.5 font-semibold ${NIVEL_ROE.alto.cls}`}>{s.alto} alto</span>}
                      {s.medio > 0 && <span className={`rounded px-2 py-0.5 font-semibold ${NIVEL_ROE.medio.cls}`}>{s.medio} medio</span>}
                      {s.bajo > 0 && <span className={`rounded px-2 py-0.5 font-semibold ${NIVEL_ROE.bajo.cls}`}>{s.bajo} bajo</span>}
                      {s.sinCalificar > 0 && <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{s.sinCalificar} sin calificar</span>}
                      {s.sinAcciones > 0 && <span className="rounded bg-orange-100 px-2 py-0.5 font-medium text-orange-800">{s.sinAcciones} sin acciones</span>}
                    </div>
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
