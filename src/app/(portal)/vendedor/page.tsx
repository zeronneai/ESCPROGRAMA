import Link from "next/link";
import { DateTime } from "luxon";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { ItemStatusBadge, SemaforoBadge } from "@/components/status";
import { requireUser } from "@/lib/auth/guards";
import { getBusinessSettings } from "@/lib/quotes/server";
import type { ItemStatus } from "@/lib/quotes/types";
import { summarizeSeller, viewState } from "@/lib/stats/seller-summary";
import { createClient } from "@/lib/supabase/server";
import { businessHoursBetween } from "@/lib/time/business-hours";

interface ItemRowDb {
  id: string;
  folio: string | null;
  producto: string;
  descripcion: string;
  estado: ItemStatus;
  quote_requests: {
    id: string;
    folio: string;
    submitted_at: string;
    due_at: string;
    customer_id: string;
    customers: { nombre: string } | null;
  };
}

const ESTADOS = [
  ["pendiente", "Pendiente"],
  ["cotizada", "Respondida sin enviar"],
  ["no_encontrada", "No encontrada"],
  ["vencida", "Vencida"],
  ["actualizacion_solicitada", "Actualización solicitada"],
  ["esperando_aclaracion", "Esperando aclaración"],
  ["enviada_cliente", "Enviada al cliente"],
] as const;

function Counter({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <Card className={tone}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

export default async function VendedorHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);

  let q = supabase
    .from("quote_items")
    .select("id, folio, producto, descripcion, estado, quote_requests!inner(id, folio, estado, submitted_at, due_at, customer_id, vendedor_id, customers(nombre))")
    .eq("quote_requests.estado", "enviada")
    .eq("quote_requests.vendedor_id", user.id)
    .order("folio", { ascending: false })
    .limit(1000);
  if (sp.desde) q = q.gte("quote_requests.submitted_at", DateTime.fromISO(sp.desde, { zone: cfg.timezone }).startOf("day").toUTC().toISO()!);
  if (sp.hasta) q = q.lte("quote_requests.submitted_at", DateTime.fromISO(sp.hasta, { zone: cfg.timezone }).endOf("day").toUTC().toISO()!);
  if (sp.cliente) q = q.eq("quote_requests.customer_id", sp.cliente);
  // Busca en el nombre y tambien en la descripcion/uso (interno), para encontrar equivalencias.
  const texto = (sp.buscar ?? "").replace(/[,()%*\\]/g, " ").trim().slice(0, 80);
  if (texto) q = q.or(`producto.ilike.%${texto}%,descripcion.ilike.%${texto}%`);

  const [{ data }, { data: drafts }, { data: clientes }] = await Promise.all([
    q,
    supabase
      .from("quote_requests")
      .select("id, created_at, customers(nombre)")
      .eq("vendedor_id", user.id)
      .eq("estado", "borrador")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("customers").select("id, nombre").eq("activo", true).order("nombre"),
  ]);

  const items = (data ?? []) as unknown as ItemRowDb[];
  const now = new Date();
  const c = summarizeSeller(items.map((i) => ({ requestId: i.quote_requests.id, estado: i.estado, dueAt: i.quote_requests.due_at })), now);
  const shown = items.filter((i) => !sp.estado || viewState(i.estado, i.quote_requests.due_at, now) === sp.estado);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Mis solicitudes</h1>
        <Link href="/vendedor/solicitudes/nueva" className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Nueva solicitud
        </Link>
      </div>

      {c.sinEnviar > 0 && (
        <div className="rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          Tienes {c.sinEnviar} partida(s) respondida(s) que aun no marcas como enviadas al cliente.{" "}
          <Link href="/vendedor?estado=cotizada" className="underline">
            Verlas
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <Counter label="Solicitudes creadas" value={c.solicitudes} />
        <Counter label="Pendientes" value={c.pendientes} />
        <Counter label="Respondidas" value={c.respondidas} />
        <Counter label="No encontradas" value={c.noEncontradas} />
        <Counter label="Vencidas" value={c.vencidas} />
        <Counter label="Enviadas al cliente" value={c.enviadas} />
        <Counter label="Respondidas sin enviar" value={c.sinEnviar} tone={c.sinEnviar > 0 ? "border-amber-400 bg-amber-50" : ""} />
        <Counter label="Actualizaciones solicitadas" value={c.actualizaciones} />
        <Counter label="Esperando tu aclaración" value={c.aclaraciones} tone={c.aclaraciones > 0 ? "border-purple-400 bg-purple-50" : ""} />
      </div>

      {(drafts ?? []).length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-medium">Borradores</h2>
          <ul className="space-y-1 text-sm">
            {(drafts ?? []).map((d) => (
              <li key={d.id}>
                <Link href={`/vendedor/solicitudes/${d.id}/editar`} className="text-brand-600 hover:underline">
                  Borrador de {(d.customers as unknown as { nombre: string } | null)?.nombre}
                </Link>{" "}
                <span className="text-xs text-slate-500">{new Date(d.created_at).toLocaleDateString("es-MX")}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <form method="get" className="grid items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-6">
        <Field label="Estado">
          <Select name="estado" defaultValue={sp.estado ?? ""}>
            <option value="">Todos</option>
            {ESTADOS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Buscar (nombre, uso o descripción)">
          <Input name="buscar" defaultValue={sp.buscar ?? ""} />
        </Field>
        <Field label="Cliente">
          <Select name="cliente" defaultValue={sp.cliente ?? ""}>
            <option value="">Todos</option>
            {(clientes ?? []).map((cl) => (
              <option key={cl.id} value={cl.id}>
                {cl.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Enviada desde">
          <Input type="date" name="desde" defaultValue={sp.desde ?? ""} />
        </Field>
        <Field label="Hasta">
          <Input type="date" name="hasta" defaultValue={sp.hasta ?? ""} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit">Filtrar</Button>
          <Link href="/vendedor" className="self-center text-sm text-slate-600 underline">
            Limpiar
          </Link>
        </div>
      </form>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-3 py-2">Partida</th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Enviada</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No hay partidas con esos filtros.
                </td>
              </tr>
            )}
            {shown.map((i) => {
              const vs = viewState(i.estado, i.quote_requests.due_at, now);
              return (
                <tr key={i.id} className="border-t border-slate-200">
                  <td className="px-3 py-2">
                    <Link href={`/vendedor/solicitudes/${i.quote_requests.id}`} className="font-medium text-brand-600 hover:underline">
                      {i.folio}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{i.producto}<div className="max-w-md truncate text-xs text-slate-500">{i.descripcion}</div></td>
                  <td className="px-3 py-2">{i.quote_requests.customers?.nombre}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(i.quote_requests.submitted_at).toLocaleDateString("es-MX", { dateStyle: "medium" })}
                  </td>
                  <td className="space-x-2 px-3 py-2 whitespace-nowrap">
                    <ItemStatusBadge estado={i.estado} vencida={vs === "vencida"} />
                    {vs === "pendiente" && (
                      <SemaforoBadge remaining={businessHoursBetween(now, new Date(i.quote_requests.due_at), cfg)} />
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
