import Link from "next/link";
import { FacturaForm } from "@/components/almacen/factura-form";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { SUBEN_FACTURA } from "@/lib/almacen";

export default async function NuevaEntrega() {
  await requireRoles([...SUBEN_FACTURA]);
  return (
    <div className="space-y-4">
      <Link href="/entregas" className="text-sm text-slate-500 hover:text-slate-800">← Entregas</Link>
      <PageHeader title="Subir factura para cargar" subtitle="El sistema lee el folio y los artículos ESC-... de la factura. Revisa y manda a almacén." />
      <FacturaForm />
    </div>
  );
}
