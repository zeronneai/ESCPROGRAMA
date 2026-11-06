import { DateTime } from "luxon";
import { DocumentosPanel } from "@/components/documentos/documentos-panel";
import { EnviarCatalogo } from "@/components/catalogo";
import { Card, PageHeader } from "@/components/ui";
import { CATALOGO } from "@/lib/marca";
import { requireUser } from "@/lib/auth/guards";
import { DOC_COLS, type DocumentoRow } from "@/lib/documentos";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function Documentos() {
  const u = await requireUser();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data, error } = await supabase.from("documentos").select(DOC_COLS).order("titulo").order("created_at", { ascending: false }).limit(2000);
  const iso = u.rol === "coordinador_iso";
  return (
    <div className="space-y-5">
      <PageHeader
        title="Documentos"
        subtitle={iso ? "Base de documentos del sistema de calidad. Tú los subes; todos los pueden consultar." : "Política de calidad, valores, manuales, procedimientos y formatos vigentes de ESC."}
      />
      <Card className="flex flex-col gap-3 border-brand-200 bg-gradient-to-r from-brand-50 to-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <a href={CATALOGO.archivo} target="_blank" rel="noreferrer" className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#0f2f7a] to-[#1d5fd6] text-xs font-bold text-white">PDF</span>
          <span>
            <span className="block font-semibold text-slate-900">{CATALOGO.nombre} <span className="ml-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Vigente</span></span>
            <span className="block text-sm text-slate-600">Catálogo de productos para clientes. Toca para abrirlo.</span>
          </span>
        </a>
        <EnviarCatalogo compacto />
      </Card>
      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudieron cargar los documentos: {error.message}</Card>}
      <DocumentosPanel docs={(data ?? []) as DocumentoRow[]} iso={iso} today={DateTime.now().setZone(cfg.timezone).toISODate()!} />
    </div>
  );
}
