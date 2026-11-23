import { ComisionesVista, type ComisionesParams } from "@/components/ventas/comisiones-vista";
import { requireRoles } from "@/lib/auth/sales";

/** Comisiones de todos los vendedores (jefa de ventas, CEO y gerente). */
export default async function Comisiones({ searchParams }: { searchParams: Promise<ComisionesParams> }) {
  await requireRoles(["jefe_ventas", "ceo", "gerente"]);
  return <ComisionesVista sp={await searchParams} ruta="/ventas/comisiones" />;
}
