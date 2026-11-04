import Link from "next/link";
import { DateTime } from "luxon";
import { OcForm, type ProvOpcion } from "@/components/pagos/oc-form";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function NuevaOc({ searchParams }: { searchParams: Promise<{ prov?: string }> }) {
  await requireRoles(["comprador"]);
  const { prov } = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data } = await supabase.from("suppliers").select("id, nombre, pagos_moneda").eq("en_pagos", true).order("nombre");
  const provs = (data ?? []) as ProvOpcion[];
  return (
    <div className="space-y-4">
      <Link href="/pagos" className="text-sm text-slate-500 hover:text-slate-800">← Pagos</Link>
      <PageHeader title="Nueva orden de compra" subtitle="La OC con sus facturas o anticipos. Lo que falte (número de factura, monto) lo completas después." />
      {provs.length === 0 ? (
        <Card className="p-4 text-sm text-slate-700">Primero agrega proveedores a la sección de pagos (en Pagos, &quot;Agregar o quitar&quot;).</Card>
      ) : (
        <OcForm oc={null} proveedores={provs} today={DateTime.now().setZone(cfg.timezone).toISODate()!} proveedorInicial={prov} />
      )}
    </div>
  );
}
