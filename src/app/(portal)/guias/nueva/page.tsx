import Link from "next/link";
import { GuiaForm } from "@/components/guias/guia-form";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";

export default async function NuevaGuia() {
  await requireRoles(["vendedor"]);
  return (
    <div className="space-y-4">
      <Link href="/guias" className="text-sm text-slate-500 hover:text-slate-800">← Guías</Link>
      <PageHeader title="Pedir guía" subtitle="Marketplaces la genera y la sube aquí. El título será: factura · persona o negocio · paquetería." />
      <Card className="p-4 sm:p-6"><GuiaForm id={null} /></Card>
    </div>
  );
}
