import { ComisionesVista, type ComisionesParams } from "@/components/ventas/comisiones-vista";
import { requireRoles } from "@/lib/auth/sales";

/** Mis comisiones (vendedor): solo las suyas. */
export default async function MisComisiones({ searchParams }: { searchParams: Promise<ComisionesParams> }) {
  const u = await requireRoles(["vendedor"]);
  return <ComisionesVista sp={await searchParams} ruta="/vendedor/comisiones" modo="vendedor" vendedorId={u.id} />;
}
