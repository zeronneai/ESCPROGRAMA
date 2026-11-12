import Link from "next/link";
import { GuiaForm } from "@/components/guias/guia-form";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { createClient } from "@/lib/supabase/server";

export default async function NuevaGuia() {
  const u = await requireRoles(["vendedor"]);
  // Sus facturas recientes (ya subidas como venta) para elegirlas y que se llenen los datos.
  const supabase = await createClient();
  const { data } = await supabase
    .from("ventas")
    .select("factura, customers(nombre)")
    .eq("vendedor_id", u.id)
    .not("factura", "is", null)
    .is("cancelada_at", null)
    .order("created_at", { ascending: false })
    .limit(40);
  const vistas = new Set<string>();
  const facturas = ((data ?? []) as unknown as { factura: string; customers: { nombre: string } | null }[])
    .filter((x) => x.factura && !vistas.has(x.factura.toUpperCase()) && vistas.add(x.factura.toUpperCase()))
    .map((x) => ({ folio: x.factura, cliente: x.customers?.nombre ?? "" }));
  return (
    <div className="space-y-4">
      <Link href="/guias" className="text-sm text-slate-500 hover:text-slate-800">← Guías</Link>
      <PageHeader title="Pedir guía" subtitle="Escribe o elige la factura: si ya la subiste como venta, se llenan solos el cliente y su domicilio. Marketplaces genera la guía y te pone el número." />
      <Card className="p-4 sm:p-6"><GuiaForm id={null} facturas={facturas} /></Card>
    </div>
  );
}
