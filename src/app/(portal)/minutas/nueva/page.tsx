import Link from "next/link";
import { DateTime } from "luxon";
import { MinutaForm, type MinutaUsuario } from "@/components/minutas/minuta-form";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { MINUTA_CREATORS } from "@/lib/ops/roles";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function NuevaMinuta() {
  const u = await requireRoles(MINUTA_CREATORS);
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data } = await supabase.rpc("minuta_usuarios");
  return (
    <div className="space-y-4">
      <Link href="/minutas" className="text-sm text-slate-500 hover:text-slate-800">← Minutas</Link>
      <PageHeader title="Nueva minuta" subtitle="Formato de minuta de reunión: datos de la junta, puntos tratados, compromisos y quién firma." />
      <MinutaForm minuta={null} firmantes={[]} usuarios={(data ?? []) as MinutaUsuario[]} yo={u.id} today={DateTime.now().setZone(cfg.timezone).toISODate()!} />
    </div>
  );
}
