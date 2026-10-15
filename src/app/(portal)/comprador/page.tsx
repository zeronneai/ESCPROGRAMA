import Link from "next/link";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { SemaforoBadge } from "@/components/status";
import { requireBuyer } from "@/lib/auth/guards";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { businessHoursBetween } from "@/lib/time/business-hours";

interface Row {
  id: string;
  folio: string;
  submitted_at: string;
  due_at: string;
  customers: { nombre: string } | null;
  profiles: { nombre: string } | null;
  quote_items: { estado: string; item_update_requests: { due_at: string; resolved_at: string | null }[] }[];
}

export default async function CompradorHome({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  await requireBuyer();
  const { ver } = await searchParams;
  const todas = ver === "todas";
  const supabase = await createClient();
  const [{ data }, cfg] = await Promise.all([
    supabase
      .from("quote_requests")
      .select("id, folio, submitted_at, due_at, customers(nombre), profiles:vendedor_id(nombre), quote_items!quote_items_request_id_fkey(estado, item_update_requests(due_at, resolved_at))")
      .eq("estado", "enviada")
      .is("archived_at", null)
      .order("due_at"),
    getBusinessSettings(supabase),
  ]);
  const now = new Date();
  const rows = ((data ?? []) as unknown as Row[])
    .map((r) => ({
      ...r,
      pendientes: r.quote_items.filter((i) => i.estado === "pendiente").length,
      actualizaciones: r.quote_items.filter((i) => i.estado === "actualizacion_solicitada").length,
      aclaraciones: r.quote_items.filter((i) => i.estado === "esperando_aclaracion").length,
      updateRemaining: Math.min(
        ...r.quote_items.flatMap((i) => i.item_update_requests.filter((u) => !u.resolved_at).map((u) => businessHoursBetween(now, new Date(u.due_at), cfg))),
        Number.POSITIVE_INFINITY,
      ),
      noEncontradas: r.quote_items.filter((i) => i.estado === "no_encontrada").length,
      remaining: businessHoursBetween(now, new Date(r.due_at), cfg),
    }))
    .filter((r) => todas || r.pendientes > 0 || r.actualizaciones > 0 || r.aclaraciones > 0 || r.noEncontradas > 0)
    .sort((a, b) => Number(b.pendientes + b.actualizaciones > 0) - Number(a.pendientes + a.actualizaciones > 0) || a.remaining - b.remaining);

  const urgentes = rows.filter((r) => r.pendientes > 0 && r.remaining <= 6).length;
  const totalPend = rows.reduce((a, r) => a + r.pendientes, 0);
  const totalAct = rows.reduce((a, r) => a + r.actualizaciones, 0);
  const totalAcl = rows.reduce((a, r) => a + r.aclaraciones, 0);

  const plazo = (r: (typeof rows)[number]) =>
    r.pendientes > 0 ? (
      <SemaforoBadge remaining={r.remaining} />
    ) : Number.isFinite(r.updateRemaining) ? (
      <SemaforoBadge remaining={r.updateRemaining} />
    ) : (
      <span className="text-xs text-slate-500">{r.aclaraciones > 0 ? "En pausa" : "Respondida"}</span>
    );
  const chips = (r: (typeof rows)[number]) => (
    <>
      {r.noEncontradas > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{r.noEncontradas} no encontrada(s)</span>}
      {r.actualizaciones > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800">{r.actualizaciones} actualización(es)</span>}
      {r.aclaraciones > 0 && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-800">{r.aclaraciones} esperando aclaración</span>}
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={todas ? "Todas las solicitudes" : "Pendientes por responder"}
        subtitle={todas ? "Incluye las ya respondidas." : "Ordenadas por tiempo restante del plazo."}
        actions={
          <>
            <FilterChip href="/comprador" active={!todas}>Pendientes</FilterChip>
            <FilterChip href="/comprador?ver=todas" active={todas}>Todas</FilterChip>
            <FilterChip href="/comprador/historial">Ver historial</FilterChip>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Partidas por cotizar" value={totalPend} tone={totalPend > 0 ? "brand" : "default"} />
        <StatCard label="Urgentes (menos de 6 h)" value={urgentes} tone={urgentes > 0 ? "red" : "default"} />
        <StatCard label="Actualizaciones" value={totalAct} tone={totalAct > 0 ? "amber" : "default"} />
        <StatCard label="Esperando aclaración" value={totalAcl} tone={totalAcl > 0 ? "purple" : "default"} />
      </div>

      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyState
            title="Todo al día"
            action={<Link href="/comprador/historial" className="text-sm font-medium text-brand-600 hover:underline">Ver lo que ya respondiste</Link>}
          >
            No hay solicitudes pendientes por responder.
          </EmptyState>
        ) : (
          <>
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Folio</th>
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-4 py-2.5 font-medium">Vendedor</th>
                  <th className="px-4 py-2.5 font-medium">Pendientes</th>
                  <th className="px-4 py-2.5 font-medium">Plazo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/comprador/solicitudes/${r.id}`} className="font-medium text-brand-600 hover:underline">
                        {r.folio}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{r.customers?.nombre}</td>
                    <td className="px-4 py-3 text-slate-600">{r.profiles?.nombre}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="tabular-nums">{r.pendientes} de {r.quote_items.length}</span>
                        {chips(r)}
                      </div>
                    </td>
                    <td className="px-4 py-3">{plazo(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/comprador/solicitudes/${r.id}`} className="block space-y-1.5 px-3 py-3 active:bg-slate-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-brand-600">{r.folio}</p>
                        <p className="truncate text-sm text-slate-900">{r.customers?.nombre}</p>
                      </div>
                      {plazo(r)}
                    </div>
                    <p className="text-xs text-slate-500">
                      {r.profiles?.nombre} · {r.pendientes} de {r.quote_items.length} pendiente(s)
                    </p>
                    <div className="flex flex-wrap gap-1">{chips(r)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
