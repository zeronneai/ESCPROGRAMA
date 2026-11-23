import { RecepcionDemo } from "@/components/recepcion/demo";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";

/** Demostracion de Recepcion de facturas (solo comprador): vendedor y auxiliar de finanzas, sin tocar la base. */
export default async function DemoRecepcion() {
  await requireRoles(["comprador"]);
  return (
    <div className="space-y-4">
      <PageHeader title="Demo: Recepción de facturas" subtitle="Muestra el proceso completo como vendedor y como auxiliar de finanzas." />
      <RecepcionDemo />
    </div>
  );
}
