import { minAlert } from "@/lib/quotes/min-purchase";
import Link from "next/link";
import { DateTime } from "luxon";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, StatCard } from "@/components/ui";
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
  cantidad: number | string | null;
  unidad: string | null;
  item_quotes: { version: number; compra_min_cantidad: number | string | null; compra_min_unidad: string | null; compra_min_monto: number | string | null }[];
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

export default async function VendedorHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);

  let q = supabase
    .from("quote_items")
    .select("id, folio, producto, descripcion, cantidad, unidad, estado, item_quotes(version, compra_min_cantidad, compra_min_unidad, compra_min_monto), quote_requests!inner(id, folio, estado, submitted_at, due_at, customer_id, vendedor_id, customers(nombre))")
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

  const filtrosActivos = [sp.estado, sp.buscar, sp.cliente, sp.desde, sp.hasta].filter(Boolean).length;
  const minBadge = (i: ItemRowDb) => {
    const last = [...(i.item_quotes ?? [])].sort((a, b) => b.version - a.version)[0];
    const alerta = last ? minAlert(i, last) : null;
    return alerta ? <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{alerta.text}</span> : null;
  };
  const estadoBadges = (i: ItemRowDb, vs: ReturnType<typeof viewState>) => (
    <>
      <ItemStatusBadge estado={i.estado} vencida={vs === "vencida"} />
      {vs === "pendiente" && <SemaforoBadge remaining={businessHoursBetween(now, new Date(i.quote_requests.due_at), cfg)} />}
    </>
  );
  const counter = (label: string, value: number, estado?: string, tone?: "amber" | "purple" | "brand") => (
    <Link href={estado ? `/vendedor?estado=${estado}` : "/vendedor"} className="block transition hover:-translate-y-0.5">
      <StatCard label={label} value={value} tone={value > 0 && tone ? tone : "default"} />
    </Link>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mis solicitudes"
        subtitle="Da seguimiento a tus cotizaciones y marca lo que ya enviaste al cliente."
        actions={
          <Link href="/vendedor/solicitudes/nueva" className="hidden rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 md:inline-flex">
            Nueva solicitud
          </Link>
        }
      />

      {c.sinEnviar > 0 && (
        <Link
          href="/vendedor?estado=cotizada"
          className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          <span>
            Tienes <strong>{c.sinEnviar}</strong> partida(s) respondida(s) que aún no marcas como enviadas al cliente.
          </span>
          <span className="shrink-0 font-medium underline">Verlas</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {counter("Solicitudes creadas", c.solicitudes)}
        {counter("Pendientes", c.pendientes, "pendiente", "brand")}
        {counter("Respondidas sin enviar", c.sinEnviar, "cotizada", "amber")}
        {counter("Esperando tu aclaración", c.aclaraciones, "esperando_aclaracion", "purple")}
        {counter("Enviadas al cliente", c.enviadas, "enviada_cliente")}
        {counter("Respondidas", c.respondidas)}
        {counter("No encontradas", c.noEncontradas, "no_encontrada")}
        {counter("Vencidas", c.vencidas, "vencida")}
        {counter("Actualizaciones solicitadas", c.actualizaciones, "actualizacion_solicitada")}
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

      <details className="group rounded-lg border border-slate-200 bg-white" open={filtrosActivos > 0 || undefined}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-slate-700">
          <span>
            Filtros{filtrosActivos > 0 && <span className="ml-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs text-white">{filtrosActivos}</span>}
          </span>
          <span className="text-slate-400 transition group-open:rotate-180">▾</span>
        </summary>
        <form method="get" className="grid items-end gap-3 border-t border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6">
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
            <Button type="submit" className="flex-1">Filtrar</Button>
            <Link href="/vendedor" className="inline-flex items-center rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
              Limpiar
            </Link>
          </div>
        </form>
      </details>

      <Card className="p-0">
        {shown.length === 0 ? (
          <EmptyState
            title={items.length === 0 ? "Aún no tienes solicitudes" : "No hay partidas con esos filtros"}
            action={
              items.length === 0 ? (
                <Link href="/vendedor/solicitudes/nueva" className="text-sm font-medium text-brand-600 hover:underline">
                  Crear la primera
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Partida</th>
                  <th className="px-4 py-2.5 font-medium">Producto</th>
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-4 py-2.5 font-medium">Enviada</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((i) => {
                  const vs = viewState(i.estado, i.quote_requests.due_at, now);
                  return (
                    <tr key={i.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={`/vendedor/solicitudes/${i.quote_requests.id}`} className="font-medium text-brand-600 hover:underline">
                          {i.folio}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {i.producto}
                        <div className="max-w-md truncate text-xs text-slate-500">{i.descripcion}</div>
                        {minBadge(i)}
                      </td>
                      <td className="px-4 py-3">{i.quote_requests.customers?.nombre}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {new Date(i.quote_requests.submitted_at).toLocaleDateString("es-MX", { dateStyle: "medium" })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">{estadoBadges(i, vs)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="divide-y divide-slate-100 md:hidden">
              {shown.map((i) => {
                const vs = viewState(i.estado, i.quote_requests.due_at, now);
                return (
                  <li key={i.id}>
                    <Link href={`/vendedor/solicitudes/${i.quote_requests.id}`} className="block space-y-1 px-3 py-3 active:bg-slate-50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-brand-600">{i.folio}</p>
                          <p className="font-medium text-slate-900">{i.producto}</p>
                        </div>
                        <span className="shrink-0 text-xs text-slate-500">
                          {new Date(i.quote_requests.submitted_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                        </span>
                      </div>
                      <p className="truncate text-xs text-slate-500">{i.quote_requests.customers?.nombre}</p>
                      <div className="flex flex-wrap gap-1.5">{estadoBadges(i, vs)}</div>
                      {minBadge(i)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
