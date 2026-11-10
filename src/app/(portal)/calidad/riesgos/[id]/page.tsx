import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { AnalisisEditor } from "@/components/riesgos/editor";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { ROL_LABEL } from "@/lib/ops/roles";
import { getBusinessSettings } from "@/lib/quotes/server";
import { normalizar, RIESGO_ROLES } from "@/lib/riesgos";
import { createClient } from "@/lib/supabase/server";
import type { Rol } from "@/lib/auth/route-guard";

export default async function Analisis({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRoles(RIESGO_ROLES);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data } = await supabase.from("riesgo_analisis").select("id, folio, proceso, fecha, area, autor_nombre, editado_nombre, created_by, updated_at, actividades").eq("id", id).maybeSingle();
  if (!data) notFound();
  const puede = data.created_by === u.id || u.rol === "coordinador_iso";
  return (
    <div className="space-y-4">
      <Link href="/calidad/riesgos" className="text-sm text-slate-500 hover:text-slate-800">← Análisis de riesgo</Link>
      <PageHeader
        title={`${data.folio} · ${data.proceso}`}
        subtitle={`${data.autor_nombre ?? ""}${data.area ? ` (${ROL_LABEL[data.area as Rol] ?? data.area})` : ""}${data.editado_nombre ? ` · última edición: ${data.editado_nombre}` : ""}${puede ? "" : " · Solo lectura"}`}
      />
      <AnalisisEditor
        id={data.id}
        folio={data.folio}
        autor={data.autor_nombre ?? undefined}
        inicial={{ proceso: data.proceso, fecha: data.fecha, actividades: normalizar(data.actividades) }}
        puedeEditar={puede}
        today={DateTime.now().setZone(cfg.timezone).toISODate()!}
      />
    </div>
  );
}
