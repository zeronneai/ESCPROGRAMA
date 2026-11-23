import Link from "next/link";
import { notFound } from "next/navigation";
import { EntregasHistorial } from "@/components/recepcion/historial";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { cargarEntregas } from "@/lib/recepcion";
import { createClient } from "@/lib/supabase/server";

/** Recepcion de facturas de un vendedor: buscar por folio, palomear recibida o rechazar, anotar. */
export default async function RecepcionVendedor({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRoles(["aux_finanzas", "supervisor_finanzas", "jefe_ventas"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: vends }, { entregas, error }] = await Promise.all([supabase.rpc("finanzas_vendedores"), cargarEntregas(supabase, id, 120)]);
  const v = ((vends ?? []) as { id: string; nombre: string }[]).find((x) => x.id === id);
  const finanzas = u.rol === "aux_finanzas" || u.rol === "supervisor_finanzas";
  return (
    <div className="space-y-4">
      <Link href="/finanzas/recepcion" className="text-sm text-slate-500 hover:text-slate-800">← Vendedores</Link>
      <PageHeader
        title={v?.nombre ?? "Vendedor"}
        subtitle={finanzas ? "Escribe el folio de cada factura física para encontrarla y palomea Recibida. Si una no vino, recházala con el motivo. Si trajo una que no está, déjalo como anotación." : "Solo lectura."}
      />
      {error && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-900">No se pudo cargar: {error}</Card>}
      <EntregasHistorial entregas={entregas} modo={finanzas ? "finanzas" : "lectura"} />
    </div>
  );
}
