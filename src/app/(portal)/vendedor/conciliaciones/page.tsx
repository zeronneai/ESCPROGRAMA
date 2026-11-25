import { ListaConciliacion } from "@/components/finanzas/lista-conciliacion";
import { Card, PageHeader, StatCard } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { cargarMovimientos, diasRestantes } from "@/lib/conciliaciones";
import { createClient } from "@/lib/supabase/server";

/** Conciliaciones (vendedor): identifica tus pagos en los estados de cuenta que sube finanzas. */
export default async function ConciliacionesVendedor() {
  const u = await requireRoles(["vendedor", "jefe_ventas"]);
  const supabase = await createClient();
  const { movs, error } = await cargarMovimientos(supabase);
  const mios = movs.filter((m) => m.vendedor_id === u.id);
  const pendientes = mios.flatMap((m) => m.facturas).filter((f) => !f.pagada).length;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Conciliaciones"
        subtitle="Estos son los pagos que llegaron al banco. Busca los tuyos (por nombre del cliente, folio o monto), dale “Es mío” y pon la factura que pagan: queda pagada con la fecha del abono. Tienes 7 días desde que se sube: después la comisión baja 10% y se paga hasta la siguiente quincena."
      />
      {error && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-900">Falta correr la actualización 0076 en la base.</Card>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Por identificar" value={movs.filter((m) => !m.tomado_por).length} tone="amber" hint={`${movs.filter((m) => !m.tomado_por && diasRestantes(m.created_at) <= 0).length} ya pasaron los 7 días`} />
        <StatCard label="Tomados por ti" value={mios.length} tone="green" />
        <StatCard label="Tus facturas por completar" value={pendientes} tone={pendientes ? "amber" : "default"} hint="Falta subir su PDF o su comisión" />
      </div>
      <ListaConciliacion movs={movs} modo="vendedor" uid={u.id} />
    </div>
  );
}
