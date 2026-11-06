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
      <PageHeader title={visita ? "Visita sin venta" : "Registrar venta sin factura"} subtitle={visita ? "Fuiste con un cliente y no compró: anota por qué." : "Lo que vendiste hoy: cliente, artículo principal, factura, pago y entrega."} />
      {!visita && (
        <div className="flex flex-col gap-3 rounded-lg border-2 border-brand-200 bg-brand-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-slate-900">¿Ya tienes la factura?</p>
            <p className="text-sm text-slate-600">Súbela en PDF y se llena todo solo: cliente, total, crédito y artículos. También se manda a almacén.</p>
          </div>
          <Link href={`/vendedor/bitacora/venta/factura${c ? `?cliente=${c.id}` : ""}`} className="inline-flex shrink-0 items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Registrar con factura (PDF)
          </Link>
        </div>
      )}
      <VentaForm initialTipo={visita ? "visita" : "venta"} venta={null} lineas={[]} customer={c ?? null} today={DateTime.now().setZone(cfg.timezone).toISODate()!} />
    </div>
  );
}
