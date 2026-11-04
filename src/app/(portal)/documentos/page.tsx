import { DateTime } from "luxon";
import { DocumentosPanel } from "@/components/documentos/documentos-panel";
import { Card, PageHeader } from "@/components/ui";
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
      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudieron cargar los documentos: {error.message}</Card>}
      <DocumentosPanel docs={(data ?? []) as DocumentoRow[]} iso={iso} today={DateTime.now().setZone(cfg.timezone).toISODate()!} />
    </div>
  );
}
