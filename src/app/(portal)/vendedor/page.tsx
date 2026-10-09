import Link from "next/link";
import { Card } from "@/components/ui";
import { SemaforoBadge } from "@/components/status";
import { requireUser } from "@/lib/auth/guards";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { businessHoursBetween } from "@/lib/time/business-hours";

interface Row {
  id: string;
  folio: string | null;
  estado: "borrador" | "enviada";
  submitted_at: string | null;
  due_at: string | null;
  created_at: string;
  customers: { nombre: string } | null;
  quote_items: { estado: string }[];
}

export default async function VendedorHome() {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data }, cfg] = await Promise.all([
    supabase
      .from("quote_requests")
      .select("id, folio, estado, submitted_at, due_at, created_at, customers(nombre), quote_items(estado)")
      .eq("vendedor_id", user.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    getBusinessSettings(supabase),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const now = new Date();
  const count = (r: Row, s: string) => r.quote_items.filter((i) => i.estado === s).length;
  const sinEnviar = rows.reduce((n, r) => n + count(r, "cotizada"), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Mis solicitudes</h1>
        <Link href="/vendedor/solicitudes/nueva" className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Nueva solicitud
        </Link>
      </div>

      {sinEnviar > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Tienes {sinEnviar} partida(s) respondida(s) que aun no marcas como enviadas al cliente.
        </div>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-3 py-2">Folio</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Partidas</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  Aun no tienes solicitudes.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const pend = count(r, "pendiente");
              const href = r.estado === "borrador" ? `/vendedor/solicitudes/${r.id}/editar` : `/vendedor/solicitudes/${r.id}`;
              return (
                <tr key={r.id} className="border-t border-slate-200">
                  <td className="px-3 py-2">
                    <Link href={href} className="font-medium text-brand-600 hover:underline">
                      {r.folio ?? "Borrador"}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.customers?.nombre}</td>
                  <td className="px-3 py-2">
                    {r.quote_items.length}
                    {r.estado === "enviada" && (
                      <span className="ml-2 text-xs text-slate-500">
                        {count(r, "cotizada") > 0 && `${count(r, "cotizada")} cotizada(s) `}
                        {count(r, "no_encontrada") > 0 && `${count(r, "no_encontrada")} no encontrada(s) `}
                        {count(r, "enviada_cliente") > 0 && `${count(r, "enviada_cliente")} enviada(s)`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.estado === "borrador" ? (
                      <span className="text-slate-500">Borrador</span>
                    ) : pend > 0 && r.due_at ? (
                      <SemaforoBadge remaining={businessHoursBetween(now, new Date(r.due_at), cfg)} />
                    ) : (
                      <span className="text-slate-600">Respondida</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
