import Link from "next/link";
import { DateTime } from "luxon";
import { VentaForm } from "@/components/venta-form";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { CUST_MIN } from "@/lib/ventas-server";

export default async function NuevaVenta({ searchParams }: { searchParams: Promise<{ cliente?: string; tipo?: string }> }) {
  await requireRoles(["vendedor"]);
  const { cliente, tipo } = await searchParams;
  const visita = tipo === "visita";
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data: c } = cliente && /^[0-9a-f-]{36}$/i.test(cliente) ? await supabase.from("customers").select(CUST_MIN).eq("id", cliente).maybeSingle() : { data: null };
  return (
    <div className="space-y-4">
      <Link href="/vendedor/bitacora" className="text-sm text-slate-500 hover:text-slate-800">← Ventas diarias</Link>
      <PageHeader title={visita ? "Visita sin venta" : "Registrar venta"} subtitle={visita ? "Fuiste con un cliente y no compró: anota por qué." : "Lo que vendiste hoy: cliente, artículo principal, factura, pago y entrega."} />
      <VentaForm initialTipo={visita ? "visita" : "venta"} venta={null} lineas={[]} customer={c ?? null} today={DateTime.now().setZone(cfg.timezone).toISODate()!} />
    </div>
  );
}
