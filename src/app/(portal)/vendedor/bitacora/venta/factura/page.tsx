import Link from "next/link";
import { DateTime } from "luxon";
import { FacturaForm } from "@/components/almacen/factura-form";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function VentaConFactura() {
  await requireRoles(["vendedor"]);
  const cfg = await getBusinessSettings(await createClient());
  return (
    <div className="space-y-4">
      <Link href="/vendedor/bitacora" className="text-sm text-slate-500 hover:text-slate-800">← Ventas diarias</Link>
      <PageHeader
        title="Registrar venta con factura"
        subtitle="Sube la factura: se registra la venta (fecha, total, contado o crédito), se da de alta o completa el cliente y, si lleva artículos, se manda a almacén para cargar."
      />
      <FacturaForm modo="venta" today={DateTime.now().setZone(cfg.timezone).toISODate()!} />
    </div>
  );
}
