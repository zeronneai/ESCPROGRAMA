import Link from "next/link";
import { DateTime } from "luxon";
import { OcForm, type ProvOpcion } from "@/components/pagos/oc-form";
import { ordenarProvs } from "@/lib/pagos";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function NuevaOc({ searchParams }: { searchParams: Promise<{ prov?: string }> }) {
  await requireRoles(["comprador"]);
  const { prov } = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  // Todos los proveedores activos: los que ya estan en pagos primero, luego los extranjeros y el resto.
  const { data } = await supabase.from("suppliers").select("id, nombre, pagos_moneda, en_pagos, tipo").eq("activo", true).order("nombre");
  const provs = ordenarProvs((data ?? []) as ProvOpcion[]);
  return (
    <div className="space-y-4">
      <Link href="/pagos" className="text-sm text-slate-500 hover:text-slate-800">← Pagos</Link>
      <PageHeader title="Nueva orden de compra" subtitle="La OC con sus facturas o anticipos. Lo que falte (número de factura, monto) lo completas después." />
      {provs.length === 0 ? (
        <Card className="p-4 text-sm text-slate-700">Todavía no hay proveedores. Dalos de alta con el botón &quot;+ Proveedor&quot;.</Card>
      ) : (
        <OcForm oc={null} proveedores={provs} today={DateTime.now().setZone(cfg.timezone).toISODate()!} proveedorInicial={prov} />
      )}
    </div>
  );
}
