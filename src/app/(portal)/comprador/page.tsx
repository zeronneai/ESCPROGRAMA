import Link from "next/link";
import { Card } from "@/components/ui";
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
      .select("id, folio, submitted_at, due_at, customers(nombre), profiles:vendedor_id(nombre), quote_items(estado, item_update_requests(due_at, resolved_at))")
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Pendientes por responder</h1>
        <Link href={todas ? "/comprador" : "/comprador?ver=todas"} className="text-sm text-brand-600 hover:underline">
          {todas ? "Ver solo pendientes" : "Ver todas las solicitudes"}
        </Link>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-3 py-2">Folio</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Vendedor</th>
              <th className="px-3 py-2">Pendientes</th>
              <th className="px-3 py-2">Plazo</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No hay solicitudes pendientes.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-200">
                <td className="px-3 py-2">
                  <Link href={`/comprador/solicitudes/${r.id}`} className="font-medium text-brand-600 hover:underline">
                    {r.folio}
                  </Link>
                </td>
                <td className="px-3 py-2">{r.customers?.nombre}</td>
                <td className="px-3 py-2">{r.profiles?.nombre}</td>
                <td className="px-3 py-2">
                  {r.pendientes} de {r.quote_items.length}
                  {r.noEncontradas > 0 && <span className="ml-2 text-xs text-slate-500">{r.noEncontradas} no encontrada(s)</span>}
                  {r.actualizaciones > 0 && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800">{r.actualizaciones} actualización(es) solicitada(s)</span>}
                  {r.aclaraciones > 0 && <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-800">{r.aclaraciones} esperando aclaración</span>}
                </td>
                <td className="px-3 py-2">
                  {r.pendientes > 0 ? (
                    <SemaforoBadge remaining={r.remaining} />
                  ) : Number.isFinite(r.updateRemaining) ? (
                    <SemaforoBadge remaining={r.updateRemaining} />
                  ) : (
                    <span className="text-slate-500">{r.aclaraciones > 0 ? "En pausa" : "Respondida"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
