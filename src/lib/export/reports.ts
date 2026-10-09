import "server-only";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditActionLabel } from "@/lib/stats/timeline";
import { fetchStatItems, type RawStatItem, type StatFilters } from "@/lib/stats/queries";
import { businessHoursBetween, type BusinessHoursConfig } from "@/lib/time/business-hours";
import type { Table } from "./tabular";

const fmt = (iso: string | null | undefined, tz: string) =>
  iso ? DateTime.fromISO(iso, { zone: tz }).toFormat("yyyy-MM-dd HH:mm") : "";
const latest = <T extends { version?: number; quote_version?: number }>(a: T[] | undefined) =>
  a?.length ? [...a].sort((x, y) => (y.version ?? y.quote_version ?? 0) - (x.version ?? x.quote_version ?? 0))[0] : undefined;
const num = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : Number(v));

/** Detalle de partidas (solo comprador: incluye costos y proveedor). */
export async function partidasReport(supabase: SupabaseClient, f: StatFilters, cfg: BusinessHoursConfig): Promise<Table> {
  const items = await fetchStatItems(supabase, f, cfg.timezone, true);
  const tz = cfg.timezone;
  const rows = items.map((i: RawStatItem) => {
    const q = latest(i.item_quotes);
    const c = latest(i.item_costs);
    const d = latest(i.item_dispatch);
    const late = i.first_response_at ? new Date(i.first_response_at) > new Date(i.quote_requests.due_at) : null;
    return [
      i.quote_requests.folio,
      i.folio,
      fmt(i.quote_requests.submitted_at, tz),
      fmt(i.quote_requests.due_at, tz),
      i.quote_requests.profiles?.nombre ?? "",
      i.quote_requests.customers?.nombre ?? "",
      i.producto,
      num(i.cantidad),
      i.unidad ?? "",
      i.talla ?? "",
      i.estado,
      fmt(i.first_response_at, tz),
      num(i.response_business_hours),
      late === null ? "" : late ? "No" : "Si",
      q?.moneda ?? "",
      num(c?.costo),
      num(c?.envio),
      num(c?.base),
      c?.proveedor ?? "",
      num(q?.price_1), num(q?.price_2), num(q?.price_3), num(q?.price_4), num(q?.price_5),
      d?.precio_elegido ?? "",
      num(d?.valor),
      fmt(d?.enviado_at, tz),
      i.not_found_note ?? "",
      q?.version ?? "",
      latest(i.item_outcomes)?.resultado ?? "",
      latest(i.item_outcomes)?.motivo ?? "",
      i.item_update_requests?.length ?? 0,
    ];
  });
  return {
    name: "Partidas",
    columns: [
      "Folio solicitud", "Folio partida", "Enviada", "Vence", "Vendedor", "Cliente", "Producto", "Cantidad", "Unidad", "Talla",
      "Estado", "Primera respuesta", "Horas habiles de respuesta", "Dentro de plazo", "Moneda", "Costo", "Envio", "Base",
      "Proveedor", "Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5", "Precio elegido", "Valor enviado",
      "Fecha envio al cliente", "Nota (no encontrada)", "Version vigente", "Resultado", "Motivo de perdida", "Actualizaciones solicitadas",
    ],
    rows,
  };
}

/** Reporte de auditoria por rango de fechas. */
export async function auditReport(
  supabase: SupabaseClient,
  range: { desde: string; hasta: string },
  tz: string,
): Promise<Table> {
  const from = DateTime.fromISO(range.desde, { zone: tz }).startOf("day").toUTC().toISO()!;
  const to = DateTime.fromISO(range.hasta, { zone: tz }).endOf("day").toUTC().toISO()!;
  const { data: people } = await supabase.from("profiles").select("id, nombre, correo");
  const names = new Map((people ?? []).map((p) => [p.id as string, `${p.nombre} (${p.correo})`]));

  const out: Array<Record<string, unknown>> = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from("audit_log")
      .select("id, at, user_id, action, entity, entity_id, old_value, new_value, meta")
      .gte("at", from)
      .lte("at", to)
      .order("id")
      .range(start, start + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return {
    name: "Auditoria",
    columns: ["#", "Fecha y hora", "Usuario", "Accion", "Detalle de accion", "Entidad", "Id", "Valor anterior", "Valor nuevo", "Meta"],
    rows: out.map((r) => [
      r.id as number,
      fmt(r.at as string, tz),
      r.user_id ? (names.get(r.user_id as string) ?? (r.user_id as string)) : "sistema",
      r.action as string,
      auditActionLabel(r.action as string),
      r.entity as string,
      (r.entity_id as string) ?? "",
      r.old_value ? JSON.stringify(r.old_value) : "",
      r.new_value ? JSON.stringify(r.new_value) : "",
      r.meta ? JSON.stringify(r.meta) : "",
    ]),
  };
}

export { businessHoursBetween };

/** Por comprar (solo comprador): partidas ganadas y donde conseguirlas. */
export async function porComprarReport(
  supabase: SupabaseClient,
  f: { proveedor?: string; desde?: string; hasta?: string; estado?: string },
  tz: string,
): Promise<Table> {
  const iso = (d: string | undefined, end: boolean) =>
    d ? (end ? DateTime.fromISO(d, { zone: tz }).endOf("day") : DateTime.fromISO(d, { zone: tz }).startOf("day")).toUTC().toISO() : null;
  const { data, error } = await supabase.rpc("por_comprar", {
    p_proveedor: f.proveedor || null,
    p_desde: iso(f.desde, false),
    p_hasta: iso(f.hasta, true),
    p_estado: f.estado || "pendientes",
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<Record<string, string | number | boolean | null>>;
  return {
    name: "Por comprar",
    columns: ["Folio partida", "Cliente", "Producto", "Cantidad", "Unidad", "Proveedor", "Link", "Contacto", "Numero de parte", "Notas de compra",
      "Costo", "Envio", "Moneda", "Version", "Ganada", "Comprada", "Comprada por", "Falta proveedor"],
    rows: rows.map((r) => [
      r.folio as string, r.cliente as string, r.producto as string, r.cantidad === null ? "" : Number(r.cantidad), (r.unidad as string) ?? (r.talla ? `Talla ${r.talla}` : ""),
      (r.proveedor as string) ?? "", (r.link_producto as string) ?? "", (r.contacto as string) ?? "", (r.numero_parte as string) ?? "", (r.notas_compra as string) ?? "",
      num(r.costo as number), num(r.envio as number | null), r.moneda as string, r.version as number,
      fmt(r.ganada_at as string, tz), fmt(r.comprada_at as string | null, tz), (r.comprada_por as string) ?? "", r.falta_proveedor ? "Si" : "No",
    ]),
  };
}
