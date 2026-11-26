import Link from "next/link";
import { Card, PageHeader, StatCard } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { createClient } from "@/lib/supabase/server";

/** Recepcion de facturas (finanzas): vendedores con facturas fisicas por recibir. */
export default async function RecepcionFinanzas() {
  await requireRoles(["aux_finanzas", "supervisor_finanzas", "jefe_ventas", "gerente", "ceo"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finanzas_vendedores");
  const rows = (data ?? []) as { id: string; nombre: string; por_revisar: number; recibidas: number; rechazadas: number; ultima: string | null }[];
  const pend = rows.reduce((a, r) => a + r.por_revisar, 0);
  return (
    <div className="space-y-5">
      <PageHeader title="Recepción de facturas" subtitle="Facturas físicas pagadas que te entregan los vendedores. Abre un vendedor para revisarlas." />
      {error && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-900">Falta correr la actualización 0070 en la base.</Card>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Por recibir" value={pend} tone={pend ? "amber" : "default"} />
        <StatCard label="Vendedores con pendientes" value={rows.filter((r) => r.por_revisar > 0).length} />
        <StatCard label="Recibidas" value={rows.reduce((a, r) => a + r.recibidas, 0)} tone="green" />
      </div>
      <Card className="divide-y divide-slate-100 p-0">
        {rows.map((r) => (
          <Link key={r.id} href={`/finanzas/recepcion/${r.id}`} className={`flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 ${r.por_revisar ? "" : "opacity-80"}`}>
            <span>
              <span className="font-semibold text-slate-900">{r.nombre}</span>
              <span className="block text-xs text-slate-500">
                {r.recibidas} recibida(s){r.rechazadas ? ` · ${r.rechazadas} rechazada(s)` : ""}
                {r.ultima ? ` · última entrega ${new Date(r.ultima).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}` : ""}
              </span>
            </span>
            {r.por_revisar > 0 ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800">{r.por_revisar} por recibir</span>
            ) : (
              <span className="text-xs text-slate-400">Al corriente</span>
            )}
          </Link>
        ))}
        {rows.length === 0 && !error && <p className="px-4 py-6 text-sm text-slate-500">Todavía ningún vendedor ha entregado facturas.</p>}
      </Card>
    </div>
  );
}
