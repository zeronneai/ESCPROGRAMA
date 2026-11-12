import Link from "next/link";
import { DateTime } from "luxon";
import { FacturaForm } from "@/components/almacen/factura-form";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { almacenVentasActivo } from "@/lib/almacen-ventas";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function VentaConFactura({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  await requireRoles(["vendedor"]);
  const { cliente } = await searchParams;
  const supabase = await createClient();
  const [cfg, almacen] = await Promise.all([getBusinessSettings(supabase), almacenVentasActivo(supabase)]);
  const { data: c } = cliente && /^[0-9a-f-]{36}$/i.test(cliente) ? await supabase.from("customers").select("id, nombre").eq("id", cliente).maybeSingle() : { data: null };
  return (
    <div className="space-y-4">
      <Link href="/vendedor/bitacora" className="text-sm text-slate-500 hover:text-slate-800">← Ventas diarias</Link>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href={`/vendedor/bitacora/venta/nueva${c ? `?cliente=${c.id}` : ""}`} className="text-brand-700 underline">No tengo la factura: venta sin factura</Link>
      </div>
      <PageHeader
        title="Registrar venta con factura"
        subtitle={`Sube la factura: se registra la venta (fecha, total, contado o crédito) y se da de alta o completa el cliente${almacen ? " y, si lleva artículos, se manda a almacén para cargar" : ""}.`}
      />
      <FacturaForm modo="venta" almacen={almacen} cliente={c ?? null} today={DateTime.now().setZone(cfg.timezone).toISODate()!} />
    </div>
  );
}
