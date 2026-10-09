import { NextResponse, type NextRequest } from "next/server";
import { computeDeadlineNotices, computeSinResultado, type DispatchedItem } from "@/lib/quotes/deadlines";
import { effectiveDueAt } from "@/lib/quotes/clock";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Pause = { clarification_requested_at: string; resumed_at: string | null };

/**
 * Tarea diaria (Vercel Cron, plan Hobby = una vez al dia). Genera avisos dentro del portal:
 *  - comprador: solicitud por vencer o vencida, y actualizaciones por vencer o vencidas;
 *  - vendedor: cotizaciones enviadas con mas de 15 dias sin resultado.
 * "Vencida" como estado NO depende de esto: se calcula al consultar.
 * Vercel envia  Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const [{ data: s }, { data: h }, { data: reqs }, { data: updates }, { data: buyers }, { data: outcomes }] = await Promise.all([
    admin.from("app_settings").select("timezone, warn_business_hours").single(),
    admin.from("holidays").select("fecha"),
    admin
      .from("quote_requests")
      .select("id, folio, due_at, quote_items!inner(estado, item_clarification_pauses(clarification_requested_at, resumed_at))")
      .eq("estado", "enviada")
      .is("archived_at", null)
      .eq("quote_items.estado", "pendiente"),
    admin
      .from("item_update_requests")
      .select("id, item_id, requested_at, due_at, quote_items!inner(folio, request_id, item_clarification_pauses(clarification_requested_at, resumed_at))")
      .is("resolved_at", null),
    admin.from("profiles").select("id").eq("rol", "comprador").eq("activo", true),
    admin
      .from("item_outcomes")
      .select("item_id, quote_version, resultado, quote_items!inner(folio, producto, request_id, quote_requests!inner(vendedor_id))")
      .eq("resultado", "sin_respuesta"),
  ]);

  const cfg = {
    timezone: s?.timezone ?? "America/Chihuahua",
    warnHours: s?.warn_business_hours ?? 12,
    holidays: (h ?? []).map((x) => x.fecha),
  };

  // 1. Solicitudes pendientes: se usa el vencimiento efectivo mas cercano (pausas por aclaracion descontadas).
  const pending = (reqs ?? []).map((r) => {
    const items = r.quote_items as unknown as { item_clarification_pauses: Pause[] }[];
    const due = new Date(r.due_at!);
    const eff = items.map((i) => effectiveDueAt(due, i.item_clarification_pauses ?? [], now, cfg).getTime());
    return { id: r.id, folio: r.folio!, due_at: new Date(Math.min(...eff)).toISOString() };
  });
  const requestNotices = computeDeadlineNotices(pending, now, cfg).map((n) => ({
    refId: n.requestId,
    tipo: n.kind,
    titulo: n.kind === "vencida" ? `Solicitud ${n.folio} vencida` : `Solicitud ${n.folio} por vencer`,
    cuerpo: n.kind === "vencida"
      ? "El plazo de respuesta ya se cumplió. Aún puedes responderla; quedará marcada como fuera de tiempo."
      : `Quedan menos de ${Math.ceil(n.remaining)} horas hábiles para responder.`,
    link: `/comprador/solicitudes/${n.requestId}`,
  }));

  // 2. Actualizaciones solicitadas por el vendedor (plazo propio de 48 horas habiles).
  const updNotices = computeDeadlineNotices(
    (updates ?? []).map((u) => {
      const qi = u.quote_items as unknown as { folio: string; request_id: string; item_clarification_pauses: Pause[] };
      const since = new Date(u.requested_at).getTime();
      const pauses = (qi.item_clarification_pauses ?? []).filter((p) => new Date(p.clarification_requested_at).getTime() >= since);
      return { id: u.id, folio: qi.folio, due_at: effectiveDueAt(new Date(u.due_at), pauses, now, cfg).toISOString(), request: qi.request_id };
    }),
    now,
    cfg,
  ).map((n) => {
    const u = (updates ?? []).find((x) => x.id === n.requestId)!;
    const qi = u.quote_items as unknown as { request_id: string };
    return {
      refId: n.requestId,
      tipo: n.kind === "vencida" ? "actualizacion_vencida" : "actualizacion_por_vencer",
      titulo: n.kind === "vencida" ? `Actualización vencida ${n.folio}` : `Actualización por vencer ${n.folio}`,
      cuerpo: n.kind === "vencida" ? "El plazo para actualizar esta cotización ya se cumplió." : `Quedan menos de ${Math.ceil(n.remaining)} horas hábiles para actualizarla.`,
      link: `/comprador/solicitudes/${qi.request_id}`,
    };
  });

  let created = 0;
  for (const n of [...requestNotices, ...updNotices]) {
    for (const b of buyers ?? []) {
      const { error } = await admin.from("notifications").insert({ user_id: b.id, tipo: n.tipo, titulo: n.titulo, cuerpo: n.cuerpo, link: n.link, ref_id: n.refId });
      if (!error) created++;
      else if (error.code !== "23505") console.error("cron avisos:", error.message);
    }
  }

  // 3. Vendedor: cotizaciones enviadas con mas de 15 dias sin resultado.
  const ids = (outcomes ?? []).map((o) => o.item_id);
  let sinResultado = 0;
  if (ids.length) {
    const { data: disp } = await admin.from("item_dispatch").select("item_id, quote_version, enviado_at").in("item_id", ids);
    const latest = new Map<string, { v: number; at: string }>();
    for (const d of disp ?? []) {
      const cur = latest.get(d.item_id);
      if (!cur || d.quote_version > cur.v) latest.set(d.item_id, { v: d.quote_version, at: d.enviado_at });
    }
    const dispatched: DispatchedItem[] = [];
    for (const o of outcomes ?? []) {
      const l = latest.get(o.item_id);
      if (!l || l.v !== o.quote_version) continue; // solo la version enviada mas reciente
      const qi = o.quote_items as unknown as { folio: string; producto: string; request_id: string; quote_requests: { vendedor_id: string } };
      dispatched.push({ itemId: o.item_id, requestId: qi.request_id, folio: qi.folio, producto: qi.producto, vendedorId: qi.quote_requests.vendedor_id, enviadoAt: l.at, resultado: "sin_respuesta" });
    }
    for (const d of computeSinResultado(dispatched, now)) {
      const { error } = await admin.from("notifications").insert({
        user_id: d.vendedorId, tipo: "sin_resultado", titulo: `Cotización sin resultado ${d.folio}`,
        cuerpo: `${d.producto}: lleva más de 15 días enviada. Marca si se ganó o se perdió.`, link: `/vendedor/solicitudes/${d.requestId}`, ref_id: d.itemId,
      });
      if (!error) { created++; sinResultado++; } else if (error.code !== "23505") console.error("cron sin_resultado:", error.message);
    }
  }

  return NextResponse.json({ revisadas: reqs?.length ?? 0, avisosComprador: requestNotices.length + updNotices.length, sinResultado, creadas: created });
}
