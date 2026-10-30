import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { BitacoraEditor } from "@/components/bitacora-editor";
import { PageHeader } from "@/components/ui";
import { requireSalesViewer } from "@/lib/auth/sales";
import { loadBitacoraDetail } from "@/lib/bitacora/detail";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function RegistroVentas({ params }: { params: Promise<{ id: string }> }) {
  await requireSalesViewer();
  const { id } = await params;
  const supabase = await createClient();
  const [d, cfg] = await Promise.all([loadBitacoraDetail(supabase, id), getBusinessSettings(supabase)]);
  if (!d) notFound();
  const isProspect = d.customer?.tipo !== "cliente";
  return (
    <div className="space-y-4">
      <Link href={d.entry.vendedor_id ? `/ventas/vendedor/${d.entry.vendedor_id}${isProspect ? "?tab=prospeccion" : ""}` : "/ventas"} className="text-sm text-slate-500 hover:text-slate-800">
        ← {d.entry.profiles?.nombre ?? "Resumen de ventas"}
      </Link>
      <PageHeader
        title={d.customer?.nombre ?? "Registro"}
        subtitle={`${isProspect ? "Prospección" : "Ventas diarias"} · ${d.entry.profiles?.nombre ?? "Sin vendedor"} · solo lectura`}
      />
      <BitacoraEditor
        mode="readonly"
        entry={d.entry}
        customer={d.customer}
        requests={d.requests}
        events={d.events}
        today={DateTime.now().setZone(cfg.timezone).toISODate()!}
        timezone={cfg.timezone}
        basePath="/ventas"
      />
    </div>
  );
}
