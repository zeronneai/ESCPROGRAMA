import Link from "next/link";
import { DateTime } from "luxon";
import { SacForm } from "@/components/calidad/sac-form";
import { emptySac } from "@/lib/ops/sac-values";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function NuevaSac({ searchParams }: { searchParams: Promise<{ queja?: string }> }) {
  const u = await requireRoles(["coordinador_iso"]);
  const { queja } = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data: quejas } = await supabase.from("quejas").select("id, numero, cliente_nombre, descripcion").neq("estado", "cerrada").order("created_at", { ascending: false }).limit(200);
  const q = (quejas ?? []).find((x) => x.id === queja) ?? null;
  return (
    <div className="space-y-4">
      <Link href={q ? `/calidad/quejas/${q.id}` : "/calidad?tab=sac"} className="text-sm text-slate-500 hover:text-slate-800">← {q ? `Queja ${q.numero}` : "Acciones correctivas"}</Link>
      <PageHeader title="Solicitud de acción correctiva" subtitle="Formato ESC-SGC-FR-001. Puedes guardarla y seguir llenándola después." />
      <Card className="p-4 sm:p-6">
        <SacForm id={null} readOnly={false} quejas={quejas ?? []} initial={emptySac(DateTime.now().setZone(cfg.timezone).toISODate()!, u.nombre, q?.id ?? null, q?.descripcion ?? "")} />
      </Card>
    </div>
  );
}
