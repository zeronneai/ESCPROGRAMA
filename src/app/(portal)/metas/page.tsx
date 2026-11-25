import { EmptyState } from "@/components/ui";
import { MetasEnVivo } from "@/components/metas/metas-en-vivo";
import { requireRoles } from "@/lib/auth/sales";
import { normalizarAvance } from "@/lib/metas-venta";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Metas de venta del mes en tiempo real (solo graficas). */
export default async function MetasPage() {
  await requireRoles(["vendedor", "jefe_ventas", "gerente", "ceo"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("metas_ventas_avance");
  if (error) return <EmptyState title="Falta la actualización de la base">Corre <code>0080_metas_ventas.sql</code> en el SQL Editor de Supabase.</EmptyState>;
  return <MetasEnVivo inicial={normalizarAvance((data ?? []) as Record<string, unknown>[])} />;
}
