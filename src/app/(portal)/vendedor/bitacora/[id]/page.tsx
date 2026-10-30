import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { BitacoraEditor } from "@/components/bitacora-editor";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { loadBitacoraDetail } from "@/lib/bitacora/detail";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function RegistroBitacora({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const supabase = await createClient();
  const [d, cfg] = await Promise.all([loadBitacoraDetail(supabase, id), getBusinessSettings(supabase)]);
  if (!d) notFound();
  const mode = !d.entry.vendedor_id ? "claim" : d.entry.vendedor_id === user.id ? "edit" : "readonly";
  const isProspect = d.customer?.tipo !== "cliente";
  return (
    <div className="space-y-4">
      <Link href={`/vendedor/bitacora${isProspect ? "?tab=prospeccion" : ""}`} className="text-sm text-slate-500 hover:text-slate-800">← Bitácora</Link>
      <PageHeader
        title={d.customer?.nombre ?? "Registro"}
        subtitle={`${isProspect ? "Prospección" : "Ventas diarias"} · creado ${DateTime.fromISO(d.entry.created_at, { zone: cfg.timezone }).setLocale("es-MX").toFormat("d LLL yyyy")}${d.entry.archived_at ? " · archivado" : ""}`}
      />
      <BitacoraEditor
        key={d.entry.updated_at}
        mode={mode}
        entry={d.entry}
        customer={d.customer}
        requests={d.requests}
        events={d.events}
        today={DateTime.now().setZone(cfg.timezone).toISODate()!}
        timezone={cfg.timezone}
      />
    </div>
  );
}
