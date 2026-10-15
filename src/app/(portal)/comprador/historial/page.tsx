import Link from "next/link";
import { DateTime } from "luxon";
import { CostHistoryChart } from "@/components/cost-history-chart";
import { ItemStatusBadge } from "@/components/status";
import { Button, Card, EmptyState, Field, FilterChip, Input, PageHeader, Pagination, StatCard } from "@/components/ui";
import { requireBuyer } from "@/lib/auth/guards";
import { getBusinessSettings } from "@/lib/quotes/server";
import type { ItemStatus } from "@/lib/quotes/types";
import { createClient } from "@/lib/supabase/server";

const RESULT = { sin_respuesta: "Sin respuesta", ganada: "Ganada", perdida: "Perdida" } as const;
type Resultado = keyof typeof RESULT;
const RESULT_TONE: Record<Resultado, string> = {
  sin_respuesta: "bg-slate-100 text-slate-700",
  ganada: "bg-green-100 text-green-800",
  perdida: "bg-red-100 text-red-800",
};

const VISTAS = [
  ["todas", "Todas"],
  ["cotizada", "Sin enviar al cliente"],
  ["enviada_cliente", "Enviadas al cliente"],
  ["no_encontrada", "No encontradas"],
  ["ganada", "Ganadas"],
  ["perdida", "Perdidas"],
] as const;
type Vista = (typeof VISTAS)[number][0];

const PAGE_SIZE = 25;

interface HistRow {
  id: string;
  folio: string | null;
  producto: string;
  descripcion: string;
  cantidad: number | string | null;
  unidad: string | null;
  estado: ItemStatus;
  first_response_at: string;
  response_business_hours: number | string | null;
  not_found_note: string | null;
  quote_requests: { id: string; customers: { nombre: string } | null; profiles: { nombre: string } | null };
  item_costs: { version: number; costo: number | string; envio: number | string | null; proveedor: string | null }[];
  item_quotes: { version: number; moneda: "MXN" | "USD"; alt_nombre: string | null }[];
  item_dispatch: { quote_version: number; precio_elegido: number; valor: number | string }[];
  item_outcomes: { quote_version: number; resultado: Resultado }[];
}

const money = (v: number | string | null | undefined) =>
  v === null || v === undefined ? "-" : `$${Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function latest<T>(rows: T[], key: (r: T) => number): T | undefined {
  return [...rows].sort((a, b) => key(b) - key(a))[0];
}

/**
 * Historial del comprador. Por defecto lista TODAS las partidas ya respondidas (mas recientes primero),
 * con contadores. La busqueda por producto o proveedor usa la similitud de nombre y muestra la grafica de costos.
 */
export default async function Historial({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireBuyer();
  const sp = await searchParams;
  const producto = sp.producto?.trim() ?? "";
  const proveedor = sp.proveedor?.trim() ?? "";
  const buscando = Boolean(producto || proveedor);
  const vista: Vista = (VISTAS.find(([v]) => v === sp.vista)?.[0] ?? "todas") as Vista;
  const page = Math.max(1, Number.parseInt(sp.pagina ?? "1", 10) || 1);

  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const now = DateTime.now().setZone(cfg.timezone);
  const since = (d: DateTime) => d.toUTC().toISO()!;

  const respondedCount = (from?: DateTime, estado?: ItemStatus) => {
    let q = supabase
      .from("quote_items")
      .select("id, quote_requests!quote_items_request_id_fkey!inner(estado)", { count: "exact", head: true })
      .eq("quote_requests.estado", "enviada")
      .not("first_response_at", "is", null);
    if (from) q = q.gte("first_response_at", since(from));
    if (estado) q = q.eq("estado", estado);
    return q;
  };

  // Lista principal (sin busqueda): partidas respondidas, paginadas.
  const outcomeJoin = vista === "ganada" || vista === "perdida" ? "item_outcomes!inner" : "item_outcomes";
  let list = supabase
    .from("quote_items")
    .select(
      `id, folio, producto, descripcion, cantidad, unidad, estado, first_response_at, response_business_hours, not_found_note,
       quote_requests!quote_items_request_id_fkey!inner(id, estado, customers(nombre), profiles:vendedor_id(nombre)),
       item_costs(version, costo, envio, proveedor),
       item_quotes(version, moneda, alt_nombre),
       item_dispatch(quote_version, precio_elegido, valor),
       ${outcomeJoin}(quote_version, resultado)`,
      { count: "exact" },
    )
    .eq("quote_requests.estado", "enviada")
    .not("first_response_at", "is", null)
    .order("first_response_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (vista === "cotizada" || vista === "enviada_cliente" || vista === "no_encontrada") list = list.eq("estado", vista);
  if (vista === "ganada" || vista === "perdida") list = list.eq("item_outcomes.resultado", vista);

  const [hoy, semana, mes, total, noEncMes, listRes, searchRes, hist, sup] = await Promise.all([
    respondedCount(now.startOf("day")),
    respondedCount(now.startOf("week")),
    respondedCount(now.startOf("month")),
    respondedCount(),
    respondedCount(now.startOf("month"), "no_encontrada"),
    buscando ? Promise.resolve({ data: [], count: 0, error: null }) : list,
    buscando
      ? supabase.rpc("similar_quotes", { p_name: producto || null, p_proveedor: proveedor || null, p_exclude_item: null, p_limit: 100 })
      : Promise.resolve({ data: [], error: null }),
    producto ? supabase.rpc("product_cost_history", { p_name: producto, p_limit: 300 }) : Promise.resolve({ data: [] }),
    supabase.from("suppliers").select("nombre").order("nombre"),
  ]);

  const error = listRes.error ?? searchRes.error ?? hoy.error;
  const rows = (listRes.data ?? []) as unknown as HistRow[];
  const pages = Math.max(1, Math.ceil((listRes.count ?? 0) / PAGE_SIZE));
  const found = (searchRes.data ?? []) as Array<{
    item_id: string; version: number; folio: string | null; producto: string; cliente: string; quoted_at: string; costo: number; envio: number | null; descripcion: string; alt_nombre: string | null;
    moneda: "MXN" | "USD"; proveedor: string | null; precio_elegido: number | null; valor_elegido: number | null; resultado: Resultado | null;
  }>;
  const points = ((hist.data ?? []) as Array<{ quoted_at: string; costo: number; moneda: "MXN" | "USD"; proveedor: string | null; producto: string; version: number }>).map((p) => ({
    fecha: p.quoted_at,
    costo: Number(p.costo),
    moneda: p.moneda,
    proveedor: p.proveedor,
    producto: p.producto,
    version: p.version,
  }));

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { vista: vista === "todas" ? undefined : vista, pagina: page > 1 ? String(page) : undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "" && !(k === "pagina" && String(v) === "1")) p.set(k, String(v));
    const s = p.toString();
    return `/comprador/historial${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Historial de cotizaciones"
        subtitle="Todo lo que ya respondiste, con costos y proveedor. Solo el comprador ve esta información."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Respondidas hoy" value={hoy.count ?? 0} tone="brand" />
        <StatCard label="Esta semana" value={semana.count ?? 0} />
        <StatCard label="Este mes" value={mes.count ?? 0} />
        <StatCard label="No encontradas (mes)" value={noEncMes.count ?? 0} />
        <StatCard label="Total respondidas" value={total.count ?? 0} />
      </div>

      <form method="get" className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:p-4">
        <Field label="Producto (nombre, uso o descripción)">
          <Input name="producto" defaultValue={producto} placeholder="Ej. guante nitrilo" />
        </Field>
        <Field label="Proveedor">
          <Input name="proveedor" list="provs-hist" defaultValue={proveedor} placeholder="Todos" />
        </Field>
        <datalist id="provs-hist">{(sup.data ?? []).map((s) => <option key={s.nombre} value={s.nombre} />)}</datalist>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1 sm:flex-none">Buscar</Button>
          {buscando && (
            <Link href="/comprador/historial" className="inline-flex items-center rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      {error && (
        <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudo cargar el historial: {error.message}</Card>
      )}

      {buscando ? (
        <>
          {producto && <CostHistoryChart points={points} />}
          <p className="text-sm text-slate-600">
            {found.length} resultado(s) para {producto && <strong>&quot;{producto}&quot;</strong>}
            {producto && proveedor && " con proveedor "}
            {proveedor && <strong>&quot;{proveedor}&quot;</strong>}
          </p>
          <Card className="p-0">
            {found.length === 0 ? (
              <EmptyState title="Sin coincidencias">Prueba con una palabra más corta o quita el proveedor.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {found.map((r) => (
                  <li key={`${r.item_id}-${r.version}`} className="grid gap-1 px-3 py-3 text-sm sm:grid-cols-[7rem_1fr_10rem_9rem] sm:gap-3 sm:px-4">
                    <span className="text-xs text-slate-500 sm:text-sm">{new Date(r.quoted_at).toLocaleDateString("es-MX", { dateStyle: "medium" })}</span>
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        {r.alt_nombre ? <>{r.alt_nombre} <span className="text-xs font-normal text-amber-700">(alternativo de {r.producto})</span></> : r.producto}
                      </p>
                      <p className="text-xs text-slate-500">
                        {r.folio}{r.version > 1 ? ` v${r.version}` : ""} · {r.cliente}
                      </p>
                      {r.descripcion && <p className="truncate text-xs text-slate-500" title={r.descripcion}>{r.descripcion}</p>}
                    </div>
                    <div className="tabular-nums">
                      {money(r.costo)} {r.moneda}
                      {r.envio ? <span className="block text-xs text-slate-500">+ envío {money(r.envio)}</span> : null}
                      <span className="block text-xs text-slate-500">{r.proveedor ?? "Sin proveedor"}</span>
                    </div>
                    <div className="flex flex-wrap items-start gap-1 text-xs">
                      {r.precio_elegido && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-900">P{r.precio_elegido} {money(r.valor_elegido)}</span>}
                      {r.resultado && <span className={`rounded-full px-2 py-0.5 ${RESULT_TONE[r.resultado]}`}>{RESULT[r.resultado]}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        <>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {VISTAS.map(([v, l]) => (
              <FilterChip key={v} href={qs({ vista: v === "todas" ? undefined : v, pagina: undefined })} active={vista === v}>
                {l}
              </FilterChip>
            ))}
          </div>

          <Card className="p-0">
            {rows.length === 0 ? (
              <EmptyState title={vista === "todas" ? "Aún no hay partidas respondidas" : "No hay partidas en esta vista"}>
                Cuando respondas una partida (cotizada o no encontrada) aparecerá aquí.
              </EmptyState>
            ) : (
              <>
                {/* Escritorio: tabla */}
                <table className="hidden w-full text-left text-sm md:table">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Respondida</th>
                      <th className="px-4 py-2.5 font-medium">Partida</th>
                      <th className="px-4 py-2.5 font-medium">Cliente / vendedor</th>
                      <th className="px-4 py-2.5 font-medium">Costo</th>
                      <th className="px-4 py-2.5 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <HistTableRow key={r.id} r={r} />
                    ))}
                  </tbody>
                </table>
                {/* Movil: tarjetas */}
                <ul className="divide-y divide-slate-100 md:hidden">
                  {rows.map((r) => (
                    <HistCard key={r.id} r={r} />
                  ))}
                </ul>
              </>
            )}
          </Card>
          <Pagination page={Math.min(page, pages)} pages={pages} hrefFor={(p) => qs({ pagina: p })} />
        </>
      )}
    </div>
  );
}

function summary(r: HistRow) {
  const cost = latest(r.item_costs ?? [], (c) => c.version);
  const quote = latest(r.item_quotes ?? [], (q) => q.version);
  const disp = latest(r.item_dispatch ?? [], (d) => d.quote_version);
  const outcome = latest(r.item_outcomes ?? [], (o) => o.quote_version);
  return { cost, quote, disp, outcome };
}

function Badges({ r }: { r: HistRow }) {
  const { disp, outcome } = summary(r);
  return (
    <div className="flex flex-wrap gap-1">
      <ItemStatusBadge estado={r.estado} />
      {disp && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-900">P{disp.precio_elegido} {money(disp.valor)}</span>}
      {outcome && <span className={`rounded-full px-2 py-0.5 text-xs ${RESULT_TONE[outcome.resultado]}`}>{RESULT[outcome.resultado]}</span>}
    </div>
  );
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

function HistTableRow({ r }: { r: HistRow }) {
  const { cost, quote } = summary(r);
  return (
    <tr className="align-top hover:bg-slate-50">
      <td className="whitespace-nowrap px-4 py-3">
        {fmtDate(r.first_response_at)}
        <span className="block text-xs text-slate-500">
          {fmtTime(r.first_response_at)}
          {r.response_business_hours !== null && ` · ${Math.round(Number(r.response_business_hours) * 10) / 10} h háb.`}
        </span>
      </td>
      <td className="max-w-sm px-4 py-3">
        <Link href={`/comprador/solicitudes/${r.quote_requests.id}`} className="font-medium text-brand-600 hover:underline">
          {r.folio}
        </Link>
        <p className="text-slate-900">{quote?.alt_nombre ?? r.producto}</p>
        {quote?.alt_nombre && <p className="text-xs text-amber-700">Alternativo de: {r.producto}</p>}
        {r.estado === "no_encontrada" && r.not_found_note && <p className="text-xs text-slate-500">Motivo: {r.not_found_note}</p>}
      </td>
      <td className="px-4 py-3">
        {r.quote_requests.customers?.nombre}
        <span className="block text-xs text-slate-500">{r.quote_requests.profiles?.nombre}</span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 tabular-nums">
        {cost ? (
          <>
            {money(cost.costo)} {quote?.moneda}
            <span className="block text-xs text-slate-500">{cost.proveedor ?? "Sin proveedor"}</span>
          </>
        ) : (
          <span className="text-slate-400">-</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Badges r={r} />
      </td>
    </tr>
  );
}

function HistCard({ r }: { r: HistRow }) {
  const { cost, quote } = summary(r);
  return (
    <li>
      <Link href={`/comprador/solicitudes/${r.quote_requests.id}`} className="block space-y-1.5 px-3 py-3 active:bg-slate-50">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-brand-600">{r.folio}</p>
            <p className="font-medium text-slate-900">{quote?.alt_nombre ?? r.producto}</p>
          </div>
          <span className="shrink-0 text-xs text-slate-500">{fmtDate(r.first_response_at)}</span>
        </div>
        <p className="text-xs text-slate-600">
          {r.quote_requests.customers?.nombre} · {r.quote_requests.profiles?.nombre}
        </p>
        {cost && (
          <p className="text-sm tabular-nums text-slate-800">
            {money(cost.costo)} {quote?.moneda} <span className="text-xs text-slate-500">· {cost.proveedor ?? "Sin proveedor"}</span>
          </p>
        )}
        <Badges r={r} />
      </Link>
    </li>
  );
}
