import { Card, PageHeader } from "@/components/ui";
import { ConfigPeriodo } from "@/components/metas/config-periodo";
import { LeerSubtotales } from "@/components/ventas/leer-subtotales";
import { requireRoles } from "@/lib/auth/sales";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Periodo de las metas (desde/hasta que dia cuentan): jefa, comprador y marketplaces. */
export default async function PeriodoMetas() {
  const u = await requireRoles(["jefe_ventas", "comprador", "marketplaces"]);
  const supabase = await createClient();
  const { data: mcfg } = await supabase.from("metas_config").select("desde, hasta").eq("id", 1).maybeSingle();
  // Comprador y jefa: volver a leer el subtotal y el vendedor de las facturas ya subidas.
  const lee = u.rol === "comprador" || u.rol === "jefe_ventas";
  const conArchivo = "factura_path.not.is.null,xml_path.not.is.null";
  const [{ count: estimados }, { count: sinVendedor }] = lee
    ? await Promise.all([
        supabase.from("ventas").select("id", { count: "exact", head: true }).eq("subtotal_estimado", true).is("cancelada_at", null).or(conArchivo),
        supabase.from("ventas").select("id", { count: "exact", head: true }).is("vendedor_factura", null).is("cancelada_at", null).or(conArchivo),
      ])
    : [{ count: null }, { count: null }];
  return (
    <div className="space-y-5">
      <PageHeader title="Periodo de metas" subtitle="Desde y hasta qué día cuentan las metas de venta. La meta del mes se ajusta en proporción a esos días." />
      <Card className="space-y-3 p-4">
        {mcfg ? <ConfigPeriodo desde={mcfg.desde} hasta={mcfg.hasta} edita /> : <p className="text-sm text-amber-800">Falta correr las actualizaciones 0081, 0083 y 0084 en Supabase.</p>}
      </Card>
      {lee && estimados != null && (
        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Leer datos de las facturas</h2>
          <p className="text-xs text-slate-500">Abre las facturas ya subidas y guarda su subtotal exacto sin IVA y el vendedor que viene impreso (ej. CASA LOCAL), para que las metas cuenten bien.</p>
          <LeerSubtotales pendientes={estimados} sinVendedor={sinVendedor ?? 0} />
        </Card>
      )}
    </div>
  );
}
