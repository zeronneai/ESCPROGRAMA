import Link from "next/link";
import { notFound } from "next/navigation";
import { addCalidadCommentAction, uploadCalidadFileAction } from "@/actions/calidad";
import { SacForm, type SacValues } from "@/components/calidad/sac-form";
import { SacExtras } from "@/components/calidad/sac-extras";
import { Chip } from "@/components/ops-ui";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { SAC_ESTADOS, type SacEstado } from "@/lib/ops/calidad";
import { fmtDate, signedUrl } from "@/lib/ops/server";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

const EV: Record<string, string> = { alta: "Acción correctiva creada", estado: "Estatus" };

export default async function Sac({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: s }, { data: ev }, { data: files }, cfg] = await Promise.all([
    supabase.from("acciones_correctivas").select("*, quejas(id, numero, cliente_nombre)").eq("id", id).maybeSingle(),
    supabase.from("calidad_eventos").select("id, tipo, nota, autor_nombre, created_at").eq("sac_id", id).order("created_at", { ascending: false }),
    supabase.from("calidad_archivos").select("id, nombre, path").eq("sac_id", id).order("created_at"),
    getBusinessSettings(supabase),
  ]);
  if (!s) notFound();
  const iso = u.rol === "coordinador_iso";
  const { data: quejas } = iso ? await supabase.from("quejas").select("id, numero, cliente_nombre").order("created_at", { ascending: false }).limit(200) : { data: null };
  const linked = s.quejas as { id: string; numero: string; cliente_nombre: string } | null;
  const estado = s.estado as SacEstado;
  const values: SacValues = {
    fecha: s.fecha, solicitante: s.solicitante, codigo_control: s.codigo_control ?? "", clausula: s.clausula ?? "", fuente: s.fuente, fuente_otro: s.fuente_otro ?? "",
    queja_id: s.queja_id, descripcion: s.descripcion, equipo: s.equipo?.length ? s.equipo : [{ nombre: "", puesto: "" }], correccion: s.correccion ?? "",
    contencion: s.contencion ?? "", consecuencia: s.consecuencia ?? "", objetivo: s.objetivo ?? "", causas: s.causas ?? {}, causa_raiz: s.causa_raiz ?? "",
    procesos_afectados: s.procesos_afectados ?? "", actualizar_riesgos: s.actualizar_riesgos, plan: s.plan ?? [], plan_crea_riesgo: s.plan_crea_riesgo,
    plan_observaciones: s.plan_observaciones ?? "", verificacion: s.verificacion ?? [], verificacion_observaciones: s.verificacion_observaciones ?? "",
    cumple_objetivo: s.cumple_objetivo, alternativa: s.alternativa ?? "", fecha_cierre: s.fecha_cierre ?? "", estado,
  };
  return (
    <div className="space-y-4">
      <Link href={linked ? `/calidad/quejas/${linked.id}` : "/calidad?tab=sac"} className="text-sm text-slate-500 hover:text-slate-800">← {linked ? `Queja ${linked.numero}` : "Acciones correctivas"}</Link>
      <div className="space-y-1">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
          {s.numero} <Chip cls={SAC_ESTADOS[estado].chip}>{SAC_ESTADOS[estado].label}</Chip>
        </h1>
        <p className="text-sm text-slate-500">
          Solicitud de acción correctiva · {fmtDate(s.created_at, cfg.timezone)}
          {linked && ` · Queja ${linked.numero} de ${linked.cliente_nombre}`}
          {!iso && " · Solo lectura (la llena el coordinador ISO)"}
        </p>
      </div>
      <Card className="p-4 sm:p-6">
        <SacForm key={s.updated_at} id={s.id} readOnly={!iso} quejas={quejas ?? (linked ? [linked] : [])} initial={values} />
      </Card>
      <SacExtras
        id={s.id}
        iso={iso}
        files={await Promise.all((files ?? []).map(async (f) => ({ id: f.id, nombre: f.nombre, url: await signedUrl(supabase, "calidad", f.path, f.nombre) })))}
        events={(ev ?? []).map((e) => ({ id: e.id, texto: e.tipo === "comentario" ? e.nota : `${EV[e.tipo] ?? e.tipo}${e.nota ? `: ${e.nota}` : ""}`, autor: e.autor_nombre, fecha: e.created_at, comentario: e.tipo === "comentario" }))}
        upload={uploadCalidadFileAction}
        comment={addCalidadCommentAction}
      />
    </div>
  );
}
