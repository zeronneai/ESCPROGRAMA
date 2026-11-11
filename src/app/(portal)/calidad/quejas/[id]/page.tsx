import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { QuejaPanel } from "@/components/calidad/queja-panel";
import { Chip, Dl } from "@/components/ops-ui";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { QUEJA_ESTADOS, quejaBloqueada, SAC_ESTADOS, VIAS, type QuejaEstado, type SacEstado, type Via } from "@/lib/ops/calidad";
import { fmtDate, fmtDay, signedUrl } from "@/lib/ops/server";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

const EV: Record<string, string> = { alta: "Queja registrada", estado: "Estatus", sac: "Se abrió la acción correctiva", archivo: "Evidencia", dictamen: "Revisión del coordinador ISO" };

export default async function Queja({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: q }, { data: ev }, { data: files }, { data: sacs }, cfg] = await Promise.all([
    supabase.from("quejas").select("*").eq("id", id).maybeSingle(),
    supabase.from("calidad_eventos").select("id, tipo, nota, autor_nombre, created_at").eq("queja_id", id).order("created_at", { ascending: false }),
    supabase.from("calidad_archivos").select("id, nombre, path").eq("queja_id", id).order("created_at"),
    supabase.from("acciones_correctivas").select("id, numero, estado, fecha").eq("queja_id", id).order("created_at"),
    getBusinessSettings(supabase),
  ]);
  if (!q) notFound();
  const iso = u.rol === "coordinador_iso";
  const isOwner = q.vendedor_id === u.id || q.created_by === u.id;
  const { data: sellers } = iso ? await supabase.from("profiles").select("id, nombre").eq("rol", "vendedor").order("nombre") : { data: null };
  const vendedor = sellers?.find((s) => s.id === q.vendedor_id)?.nombre;
  const estado = q.estado as QuejaEstado;
  const bloqueada = quejaBloqueada(estado);
  return (
    <div className="space-y-4">
      <Link href="/calidad" className="text-sm text-slate-500 hover:text-slate-800">← Quejas</Link>
      <div className="space-y-1">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
          {q.numero} · {q.cliente_nombre} <Chip cls={QUEJA_ESTADOS[estado].chip}>{QUEJA_ESTADOS[estado].label}</Chip>
        </h1>
        <p className="text-sm text-slate-500">Registrada {fmtDate(q.created_at, cfg.timezone)}{q.cerrada_at && ` · Cerrada ${fmtDate(q.cerrada_at, cfg.timezone)}`}</p>
      </div>
      <Card className="space-y-4 p-4">
        <Dl
          items={[
            ["Fecha de recepción", fmtDay(q.fecha_recepcion)],
            ["Vía de recepción", VIAS[q.via_recepcion as Via]],
            ["Responsable de la recepción", q.responsable_nombre],
            ["Vendedor", vendedor],
            ["Cliente", q.cliente_nombre],
            ["Persona de contacto", q.contacto_nombre],
            ["Teléfono / correo", q.contacto_medio],
            ["Pedido / factura / OC", q.referencia],
            ["Revisó si aplica", q.dictamen_nombre ? `${q.dictamen_nombre}${q.dictamen_at ? ` · ${fmtDate(q.dictamen_at, cfg.timezone)}` : ""}` : null],
          ]}
        />
        {iso && q.origen === "link" && estado === "por_revisar" && (
          <p className="rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-900">El cliente la mandó desde el link de quejas. Revisa los datos y decide si aplica.</p>
        )}
        {q.dictamen_nota && (
          <div className={`rounded-md p-3 ${estado === "no_aplica" ? "bg-slate-100" : "bg-sky-50"}`}>
            <p className={`text-xs font-medium ${estado === "no_aplica" ? "text-slate-600" : "text-sky-800"}`}>{estado === "no_aplica" ? "Por qué no aplica" : "Comentario de la revisión"}</p>
            <p className="whitespace-pre-line text-sm text-slate-900">{q.dictamen_nota}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-slate-500">Descripción del problema / queja</p>
          <p className="whitespace-pre-line text-sm text-slate-900">{q.descripcion}</p>
        </div>
        {q.solucion && (
          <div className="rounded-md bg-green-50 p-3">
            <p className="text-xs font-medium text-green-800">Solución / respuesta al cliente</p>
            <p className="whitespace-pre-line text-sm text-green-900">{q.solucion}</p>
          </div>
        )}
        {(sacs ?? []).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-slate-500">Acciones correctivas</p>
            {(sacs ?? []).map((s) => (
              <Link key={s.id} href={`/calidad/sac/${s.id}`} className="flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline">
                {s.numero} <Chip cls={SAC_ESTADOS[s.estado as SacEstado].chip}>{SAC_ESTADOS[s.estado as SacEstado].label}</Chip>
              </Link>
            ))}
          </div>
        )}
      </Card>
      <QuejaPanel
        q={{ id: q.id, estado, solucion: q.solucion, vendedor_id: q.vendedor_id }}
        role={u.rol}
        canEdit={iso || (u.rol === "vendedor" && q.created_by === u.id && (estado === "abierta" || estado === "por_revisar"))}
        canWrite={!bloqueada && (iso || (u.rol === "vendedor" && isOwner))}
        today={DateTime.now().setZone(cfg.timezone).toISODate()!}
        sellers={sellers ?? undefined}
        form={{ fecha_recepcion: q.fecha_recepcion, via_recepcion: q.via_recepcion, responsable_nombre: q.responsable_nombre ?? "", customer_id: q.customer_id, cliente_nombre: q.cliente_nombre, contacto_nombre: q.contacto_nombre ?? "", contacto_medio: q.contacto_medio ?? "", referencia: q.referencia ?? "", descripcion: q.descripcion, vendedor_id: q.vendedor_id }}
        files={await Promise.all((files ?? []).map(async (f) => ({ id: f.id, nombre: f.nombre, url: await signedUrl(supabase, "calidad", f.path, f.nombre) })))}
        events={(ev ?? []).map((e) => ({ id: e.id, texto: e.tipo === "comentario" ? e.nota : `${EV[e.tipo] ?? e.tipo}${e.nota ? `: ${e.nota}` : ""}`, autor: e.autor_nombre, fecha: e.created_at, comentario: e.tipo === "comentario" }))}
      />
    </div>
  );
}
