import Link from "next/link";
import { redirect } from "next/navigation";
import { FacturaForm } from "@/components/almacen/factura-form";
import { Alert, PageHeader } from "@/components/ui";
import { almacenVentasActivo } from "@/lib/almacen-ventas";
import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/auth/sales";
import { SUBEN_FACTURA } from "@/lib/almacen";

export default async function NuevaEntrega() {
  const u = await requireRoles([...SUBEN_FACTURA]);
  // El vendedor sube la factura una sola vez: se registra la venta y se manda a almacen.
  if (u.rol === "vendedor") redirect("/vendedor/bitacora/venta/factura");
  if (!(await almacenVentasActivo(await createClient())))
    return (
      <div className="space-y-4">
        <PageHeader title="Subir factura para cargar" />
        <Alert tone="info">Almacén todavía no está conectado a ventas (no hay inventario). El comprador lo prende en Configuración cuando esté listo.</Alert>
      </div>
    );
  return (
    <div className="space-y-4">
      <Link href="/entregas" className="text-sm text-slate-500 hover:text-slate-800">← Entregas</Link>
      <PageHeader title="Subir factura para cargar" subtitle="El sistema lee el folio y los artículos ESC-... de la factura. Revisa y manda a almacén." />
      <FacturaForm />
    </div>
  );
}
