import Link from "next/link";
import { DateTime } from "luxon";
import { RecepcionForm } from "@/components/almacen/recepcion-form";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function NuevaRecepcion() {
  await requireRoles(["almacen", "supervisor_almacen"]);
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data } = await supabase.from("suppliers").select("nombre").eq("activo", true).order("nombre").limit(1000);
  return (
    <div className="space-y-4">
      <Link href="/almacen/recepciones" className="text-sm text-slate-500 hover:text-slate-800">← Recepciones</Link>
      <PageHeader title="Nueva recepción" subtitle="Registra lo que llegó. Al guardar se generan las etiquetas para imprimir y pegar." />
      <RecepcionForm today={DateTime.now().setZone(cfg.timezone).toISODate()!} proveedores={(data ?? []).map((s) => s.nombre as string)} />
    </div>
  );
}
