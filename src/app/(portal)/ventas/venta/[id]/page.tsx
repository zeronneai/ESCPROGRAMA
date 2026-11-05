import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { VentaForm } from "@/components/venta-form";
import { VentaFacturaInfo } from "@/components/ventas/venta-factura-info";
import { PageHeader } from "@/components/ui";
import { requireSalesViewer } from "@/lib/auth/sales";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { loadVenta } from "@/lib/ventas-server";

export default async function VentaLectura({ params }: { params: Promise<{ id: string }> }) {
  await requireSalesViewer();
  const { id } = await params;
  const supabase = await createClient();
  const [d, cfg] = await Promise.all([loadVenta(supabase, id), getBusinessSettings(supabase)]);
  if (!d) notFound();
  const back = `/ventas/vendedor/${d.venta.vendedor_id}`;
  return (
    <div className="space-y-4">
      <Link href={back} className="text-sm text-slate-500 hover:text-slate-800">← {d.vendedor ?? "Vendedor"}</Link>
      <PageHeader title={`Venta a ${d.customer?.nombre ?? "cliente"}`} subtitle={`${d.vendedor ?? ""} · solo lectura`} />
      <VentaFacturaInfo ventaId={d.venta.id} />
      <VentaForm venta={d.venta} lineas={d.lineas} customer={d.customer} today={DateTime.now().setZone(cfg.timezone).toISODate()!} readOnly backHref={back} requestFolio={d.folio} />
    </div>
  );
}
