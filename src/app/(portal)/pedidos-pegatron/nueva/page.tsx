import Link from "next/link";
import { NuevaOcPegatron } from "@/components/pegatron/nueva-oc";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { createClient } from "@/lib/supabase/server";

export default async function NuevaOcPegatronPage() {
  await requireRoles(["jefe_ventas"]);
  const supabase = await createClient();
  const { data: arts } = await supabase.from("articulos").select("clave, nombre").order("clave").limit(5000);
  return (
    <div className="space-y-4">
      <Link href="/pedidos-pegatron" className="text-sm text-slate-500 hover:text-brand-700">← Pedidos Pegatron</Link>
      <PageHeader
        title="Nueva OC de Pegatron"
        subtitle="Sube el PDF de la orden de compra: leemos la descripción y la cantidad de cada renglón. Tú escribes el artículo ESC (como lo conocemos nosotros) y se lo mandamos a compras."
      />
      <NuevaOcPegatron catalogo={(arts ?? []) as { clave: string; nombre: string }[]} />
    </div>
  );
}
