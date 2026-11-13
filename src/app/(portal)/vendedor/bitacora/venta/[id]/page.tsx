import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { VentaForm } from "@/components/venta-form";
import { VentaFacturaInfo } from "@/components/ventas/venta-factura-info";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { loadVenta } from "@/lib/ventas-server";

export default async function Venta({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nueva?: string }> }) {
  const u = await requireRoles(["vendedor", "jefe_ventas"]);
  const { id } = await params;
  const { nueva } = await searchParams;
  const supabase = await createClient();
  const [d, cfg] = await Promise.all([loadVenta(supabase, id), getBusinessSettings(supabase)]);
  if (!d) notFound();
  return (
    <div className="space-y-4">
      <Link href="/vendedor/bitacora" className="text-sm text-slate-500 hover:text-slate-800">← Ventas diarias</Link>
      <PageHeader title={`Venta a ${d.customer?.nombre ?? "cliente"}`} subtitle={`${new Date(`${d.venta.fecha}T12:00:00`).toLocaleDateString("es-MX", { dateStyle: "long" })}${d.venta.factura ? ` · Factura ${d.venta.factura}` : ""}`} />
      <VentaFacturaInfo ventaId={id} nueva={nueva === "factura"} />
      <VentaForm venta={d.venta} lineas={d.lineas} customer={d.customer} today={DateTime.now().setZone(cfg.timezone).toISODate()!} readOnly={d.venta.vendedor_id !== u.id} requestFolio={d.folio} />
    </div>
  );
}
