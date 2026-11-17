import Link from "next/link";
import { GuiaForm } from "@/components/guias/guia-form";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { createClient } from "@/lib/supabase/server";

export default async function NuevaGuia() {
  const u = await requireRoles(["vendedor", "comprador"]);
  const compras = u.rol === "comprador";
  // Facturas recientes (ya subidas como venta) para elegirlas y que se llenen los datos.
  // El vendedor ve las suyas; compras puede usar cualquiera.
  const supabase = await createClient();
  let consulta = supabase.from("ventas").select("factura, customers(nombre)");
  if (!compras) consulta = consulta.eq("vendedor_id", u.id);
  const { data } = await consulta
    .not("factura", "is", null)
    .is("cancelada_at", null)
    .order("created_at", { ascending: false })
    .limit(40);
  const vistas = new Set<string>();
  const facturas = ((data ?? []) as unknown as { factura: string; customers: { nombre: string } | null }[])
    .filter((x) => x.factura && !vistas.has(x.factura.toUpperCase()) && vistas.add(x.factura.toUpperCase()))
    .map((x) => ({ folio: x.factura, cliente: x.customers?.nombre ?? "" }));
  // Recolecciones de compras: recibe el comprador en ESC, con el telefono de la empresa.
  const { data: emp } = compras ? await supabase.from("company_profile").select("telefono").limit(1).maybeSingle() : { data: null };
  const contactoEsc = compras ? { nombre: u.nombre ?? "", telefono: (emp as { telefono?: string | null } | null)?.telefono ?? "" } : undefined;
  return (
    <div className="space-y-4">
      <Link href="/guias" className="text-sm text-slate-500 hover:text-slate-800">← Guías</Link>
      <PageHeader
        title="Pedir guía"
        subtitle={compras
          ? "Recolección con proveedor: sube la OC y se llenan el proveedor (origen) y ESC (destino). También puedes pedir un envío normal a un cliente. Marketplaces genera la guía y la descargas aquí."
          : "Escribe o elige la factura: si ya la subiste como venta, se llenan solos el cliente y su domicilio. Marketplaces genera la guía y te pone el número."}
      />
      <Card className="p-4 sm:p-6"><GuiaForm id={null} facturas={facturas} referencia={compras} contactoEsc={contactoEsc} /></Card>
    </div>
  );
}
