import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import type { StatRow } from "./buyer-stats";
import { effectiveDueAt } from "@/lib/quotes/clock";
import type { ItemStatus } from "@/lib/quotes/types";
import type { BusinessHoursConfig } from "@/lib/time/business-hours";

export interface StatFilters {
  desde?: string; // yyyy-MM-dd
  hasta?: string; // yyyy-MM-dd
  vendedor?: string;
  cliente?: string;
  moneda?: string;
}

export interface RawStatItem {
  id: string;
  folio: string | null;
  producto: string;
  cantidad: number | string | null;
  unidad: string | null;
  talla: string | null;
  estado: ItemStatus;
  first_response_at: string | null;
  response_business_hours: number | string | null;
  not_found_note: string | null;
  quote_requests: {
    id: string;
    folio: string;
    submitted_at: string;
    due_at: string;
    vendedor_id: string;
    customer_id: string;
    customers: { nombre: string } | null;
    profiles: { nombre: string } | null;
  };
  item_quotes: Array<{
    version: number;
    moneda: "MXN" | "USD";
    price_1: number | string;
    price_2: number | string;
    price_3: number | string;
    price_4: number | string;
    price_5: number | string;
    quoted_at: string;
  }>;
  item_dispatch: Array<{ quote_version: number; precio_elegido: number; valor: number | string; enviado_at: string }>;
  item_outcomes: Array<{ quote_version: number; resultado: "sin_respuesta" | "ganada" | "perdida"; motivo: string | null; cantidad_final: number | string | null }>;
  item_update_requests: Array<{ requested_at: string; resolved_at: string | null; response_business_hours: number | string | null }>;
  item_clarification_pauses: Array<{ clarification_requested_at: string; resumed_at: string | null }>;
  item_costs?: Array<{ version: number; costo: number | string; envio: number | string | null; base: number | string; proveedor: string | null }>;
}

const PAGE = 1000;

/** Trae todas las partidas enviadas que cumplan los filtros (paginado). */
export async function fetchStatItems(
  supabase: SupabaseClient,
  f: StatFilters,
  timezone: string,
  withCosts = false,
): Promise<RawStatItem[]> {
  const out: RawStatItem[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("quote_items")
      .select(
        `id, folio, producto, cantidad, unidad, talla, estado, first_response_at, response_business_hours, not_found_note,
         quote_requests!inner(id, folio, submitted_at, due_at, vendedor_id, customer_id, estado, customers(nombre), profiles:vendedor_id(nombre)),
         item_quotes(version, moneda, price_1, price_2, price_3, price_4, price_5, quoted_at),
         item_dispatch(quote_version, precio_elegido, valor, enviado_at),
         item_outcomes(quote_version, resultado, motivo, cantidad_final),
         item_update_requests(requested_at, resolved_at, response_business_hours),
         item_clarification_pauses(clarification_requested_at, resumed_at)${withCosts ? ",\n         item_costs(version, costo, envio, base, proveedor)" : ""}`,
      )
      .eq("quote_requests.estado", "enviada")
      .order("id")
      .range(from, from + PAGE - 1);
    if (f.desde) q = q.gte("quote_requests.submitted_at", DateTime.fromISO(f.desde, { zone: timezone }).startOf("day").toUTC().toISO()!);
    if (f.hasta) q = q.lte("quote_requests.submitted_at", DateTime.fromISO(f.hasta, { zone: timezone }).endOf("day").toUTC().toISO()!);
    if (f.vendedor) q = q.eq("quote_requests.vendedor_id", f.vendedor);
    if (f.cliente) q = q.eq("quote_requests.customer_id", f.cliente);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as RawStatItem[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  const latest = <T extends { version?: number; quote_version?: number }>(a: T[]) =>
    [...a].sort((x, y) => (y.version ?? y.quote_version ?? 0) - (x.version ?? x.quote_version ?? 0))[0];
  return f.moneda ? out.filter((i) => i.item_quotes.length && latest(i.item_quotes).moneda === f.moneda) : out;
}

export function toStatRows(items: RawStatItem[], cfg: BusinessHoursConfig, now = new Date()): StatRow[] {
  const latest = <T extends { version?: number; quote_version?: number }>(a: T[]) =>
    a.length ? [...a].sort((x, y) => (y.version ?? y.quote_version ?? 0) - (x.version ?? x.quote_version ?? 0))[0] : undefined;
  return items.map((i) => {
    const outcome = latest(i.item_outcomes);
    const disp = latest(i.item_dispatch);
    return {
    requestId: i.quote_requests.id,
    requestFolio: i.quote_requests.folio,
    submittedAt: i.quote_requests.submitted_at,
    // Vencimiento efectivo: due_at mas las horas habiles en pausa por aclaraciones.
    dueAt: effectiveDueAt(new Date(i.quote_requests.due_at), i.item_clarification_pauses ?? [], now, cfg).toISOString(),
    vendedorId: i.quote_requests.vendedor_id,
    vendedorNombre: i.quote_requests.profiles?.nombre ?? "",
    customerId: i.quote_requests.customer_id,
    customerNombre: i.quote_requests.customers?.nombre ?? "",
    itemId: i.id,
    estado: i.estado,
    firstResponseAt: i.first_response_at,
    responseHours: i.response_business_hours === null ? null : Number(i.response_business_hours),
    notFoundNote: i.not_found_note,
    moneda: latest(i.item_quotes)?.moneda ?? null,
    precioElegido: disp?.precio_elegido ?? null,
    cantidad: i.cantidad === null ? null : Number(i.cantidad),
    valorUnitario: disp ? Number(disp.valor) : null,
    outcome: outcome?.resultado ?? null,
    outcomeMotivo: outcome?.motivo ?? null,
    cantidadFinal: outcome?.cantidad_final ? Number(outcome.cantidad_final) : null,
    updates: (i.item_update_requests ?? []).map((u) => ({
      requestedAt: u.requested_at,
      resolvedAt: u.resolved_at,
      hours: u.response_business_hours === null ? null : Number(u.response_business_hours),
    })),
    };
  });
}

/** Rango por defecto: ultimos 90 dias. */
export function defaultRange(timezone: string): { desde: string; hasta: string } {
  const now = DateTime.now().setZone(timezone);
  return { desde: now.minus({ days: 90 }).toISODate()!, hasta: now.toISODate()! };
}
