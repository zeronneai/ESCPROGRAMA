import { Card, PageHeader } from "@/components/ui";
import { ConfigPeriodo } from "@/components/metas/config-periodo";
import { requireRoles } from "@/lib/auth/sales";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Periodo de las metas (desde/hasta que dia cuentan): jefa, comprador y marketplaces. */
export default async function PeriodoMetas() {
  await requireRoles(["jefe_ventas", "comprador", "marketplaces"]);
  const supabase = await createClient();
  const { data: mcfg } = await supabase.from("metas_config").select("desde, hasta").eq("id", 1).maybeSingle();
  return (
    <div className="space-y-5">
      <PageHeader title="Periodo de metas" subtitle="Desde y hasta qué día cuentan las metas de venta. La meta del mes se ajusta en proporción a esos días." />
      <Card className="space-y-3 p-4">
        {mcfg ? <ConfigPeriodo desde={mcfg.desde} hasta={mcfg.hasta} edita /> : <p className="text-sm text-amber-800">Falta correr las actualizaciones 0081, 0083 y 0084 en Supabase.</p>}
      </Card>
    </div>
  );
}
