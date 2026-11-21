import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { BitacoraEditor } from "@/components/bitacora-editor";
import { PausaProspecto } from "@/components/bitacora-pausa";
import { PageHeader } from "@/components/ui";
import { requireSalesViewer } from "@/lib/auth/sales";
import { loadBitacoraDetail } from "@/lib/bitacora/detail";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function RegistroVentas({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSalesViewer();
  const { id } = await params;
  const supabase = await createClient();
  const [d, cfg] = await Promise.all([loadBitacoraDetail(supabase, id), getBusinessSettings(supabase)]);
  if (!d) notFound();
  return (
    <div className="space-y-4">
      <Link href={d.entry.vendedor_id ? `/ventas/vendedor/${d.entry.vendedor_id}?tab=prospeccion` : "/ventas"} className="text-sm text-slate-500 hover:text-slate-800">
        ← {d.entry.profiles?.nombre ?? "Resumen de ventas"}
      </Link>
      <PageHeader
        title={d.customer?.nombre ?? "Registro"}
        subtitle={`Prospección · ${d.entry.profiles?.nombre ?? "Sin vendedor"} · solo lectura`}
      />
      {d.entry.resultado === "abierta" && !d.entry.archived_at && d.entry.vendedor_id && (
        <PausaProspecto id={d.entry.id} pausadaAt={d.entry.pausada_at ?? null} motivo={d.entry.pausa_motivo ?? null} puede={user.rol === "jefe_ventas"} />
      )}
      <BitacoraEditor
        mode="readonly"
        entry={d.entry}
        customer={d.customer}
        requests={d.requests}
        events={d.events}
        articulos={d.articulos}
        today={DateTime.now().setZone(cfg.timezone).toISODate()!}
        timezone={cfg.timezone}
        basePath="/ventas"
      />
    </div>
  );
}
