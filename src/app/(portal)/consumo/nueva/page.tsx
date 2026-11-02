import Link from "next/link";
import { redirect } from "next/navigation";
import { ConsumoForm } from "@/components/consumo/consumo-form";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";

export default async function NuevoConsumo() {
  const u = await requireUser();
  if (u.rol === "comprador") redirect("/consumo");
  return (
    <div className="space-y-4">
      <Link href="/consumo" className="text-sm text-slate-500 hover:text-slate-800">← Consumo interno</Link>
      <PageHeader title="Nueva solicitud de consumo interno" subtitle="Papelería, limpieza, cafetería, servicio de vehículos y lo del día a día." />
      <Card className="p-4 sm:p-6"><ConsumoForm id={null} /></Card>
    </div>
  );
}
