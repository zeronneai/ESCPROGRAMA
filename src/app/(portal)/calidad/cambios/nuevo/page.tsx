import Link from "next/link";
import { DateTime } from "luxon";
import { CambioForm, type DocOpcion } from "@/components/documentos/cambio-form";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function NuevoCambio() {
  await requireRoles(["coordinador_iso"]);
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data } = await supabase.from("documentos").select("id, codigo, titulo, version").eq("vigente", true).order("titulo");
  return (
    <div className="space-y-4">
      <Link href="/calidad/cambios" className="text-sm text-slate-500 hover:text-slate-800">← Control de cambios</Link>
      <PageHeader title="Registrar cambio" subtitle="Versión base del formato de control de cambios; se ajusta cuando esté el formato oficial." />
      <CambioForm cambio={null} docs={(data ?? []) as DocOpcion[]} today={DateTime.now().setZone(cfg.timezone).toISODate()!} />
    </div>
  );
}
