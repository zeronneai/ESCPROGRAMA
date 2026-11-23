import { ComisionesVista, type ComisionesParams } from "@/components/ventas/comisiones-vista";
import { requireRoles } from "@/lib/auth/sales";

/** Comisiones de todos los vendedores (jefa de ventas, CEO y gerente). */
export default async function Comisiones({ searchParams }: { searchParams: Promise<ComisionesParams> }) {
  const u = await requireRoles(["jefe_ventas", "ceo", "gerente"]);
  // La jefa revisa y corrige; la gerente (y el CEO) solo ven lo revisado, para pagarlo.
  return <ComisionesVista sp={await searchParams} ruta="/ventas/comisiones" modo={u.rol === "jefe_ventas" ? "jefa" : "gerente"} />;
}
