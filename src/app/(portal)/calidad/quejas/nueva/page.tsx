import Link from "next/link";
import { DateTime } from "luxon";
import { QuejaForm } from "@/components/calidad/queja-form";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function NuevaQueja() {
  const u = await requireRoles(["vendedor", "coordinador_iso"]);
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data: sellers } = u.rol === "coordinador_iso" ? await supabase.from("profiles").select("id, nombre").eq("rol", "vendedor").eq("activo", true).order("nombre") : { data: null };
  return (
    <div className="space-y-4">
      <Link href="/calidad" className="text-sm text-slate-500 hover:text-slate-800">← Quejas</Link>
      <PageHeader title="Nueva queja de cliente" subtitle="Formato ESC-SGC-FR-002. El coordinador ISO recibe el aviso y le da seguimiento." />
      <Card className="p-4 sm:p-6"><QuejaForm id={null} today={DateTime.now().setZone(cfg.timezone).toISODate()!} sellers={sellers ?? undefined} /></Card>
    </div>
  );
}
