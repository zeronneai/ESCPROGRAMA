import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { CambioForm, type DocOpcion } from "@/components/documentos/cambio-form";
import { Chip, Dl } from "@/components/ops-ui";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { CAMBIO_COLS, docNombre, ESTADOS_CAMBIO, TIPOS_CAMBIO, type CambioRow } from "@/lib/documentos";
import { fmtDate, fmtDay } from "@/lib/ops/server";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function Cambio({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRoles(["coordinador_iso", "gerente", "ceo", "comprador"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data } = await supabase.from("control_cambios").select(CAMBIO_COLS).eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as unknown as CambioRow;
  const iso = u.rol === "coordinador_iso";
  const docs = iso ? ((await supabase.from("documentos").select("id, codigo, titulo, version").eq("vigente", true).order("titulo")).data ?? []) : [];
  return (
    <div className="space-y-4">
      <Link href="/calidad/cambios" className="text-sm text-slate-500 hover:text-slate-800">← Control de cambios</Link>
      <PageHeader
        title={docNombre(c.documentos, c.documento_texto)}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{c.numero}</span><Chip cls={ESTADOS_CAMBIO[c.estado].cls}>{ESTADOS_CAMBIO[c.estado].label}</Chip></span>}
      />
      {iso ? (
        <CambioForm cambio={c} docs={docs as DocOpcion[]} today={DateTime.now().setZone(cfg.timezone).toISODate()!} />
      ) : (
        <Card className="space-y-4 p-4 sm:p-5">
          <Dl
            items={[
              ["Fecha", fmtDay(c.fecha)],
              ["Tipo de cambio", TIPOS_CAMBIO[c.tipo]],
              ["Documento", docNombre(c.documentos, c.documento_texto)],
              ...(c.documentos && c.documento_texto ? [["Referencia", c.documento_texto] as [string, string]] : []),
              ["Área o proceso", c.area ?? ""],
              ["Versión", c.version_anterior || c.version_nueva ? `${c.version_anterior ?? "?"} a ${c.version_nueva ?? "?"}` : ""],
              ["Solicitado por", c.solicitado_por ?? ""],
              ["Aprobado por", c.aprobado_por ?? ""],
              ["Implementación", fmtDay(c.fecha_implementacion)],
              ["Registró", `${c.autor_nombre ?? ""} · ${fmtDate(c.created_at, cfg.timezone)}`],
            ]}
          />
          <div>
            <p className="text-xs font-medium text-slate-500">Descripción del cambio</p>
            <p className="whitespace-pre-wrap text-sm text-slate-900">{c.descripcion}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Motivo</p>
            <p className="whitespace-pre-wrap text-sm text-slate-900">{c.motivo}</p>
          </div>
          {c.notas && (
            <div>
              <p className="text-xs font-medium text-slate-500">Notas</p>
              <p className="whitespace-pre-wrap text-sm text-slate-900">{c.notas}</p>
            </div>
          )}
          {c.documento_id && <a href={`/api/documentos/${c.documento_id}`} target="_blank" rel="noreferrer" className="inline-block text-sm text-brand-700 underline">Ver el documento</a>}
        </Card>
      )}
    </div>
  );
}
