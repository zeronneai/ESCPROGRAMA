import Link from "next/link";
import { notFound } from "next/navigation";
import { SemaforoBadge } from "@/components/status";
import { Card } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { requireBuyer } from "@/lib/auth/guards";
import { remainingWithPauses } from "@/lib/quotes/clock";
import { requestRevision, revisionFolio } from "@/lib/quotes/revisions";
import { getBusinessSettings, withMessageImageUrls, withSignedUrls } from "@/lib/quotes/server";
import type { ItemRow } from "@/lib/quotes/types";
import { auditActionLabel, buildTimeline } from "@/lib/stats/timeline";
import { businessHoursBetween } from "@/lib/time/business-hours";
import { createClient } from "@/lib/supabase/server";
import { BuyerItemCard, type BuyerItem } from "./buyer-item-card";
import type { Factors } from "@/components/quote-form";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function CompradorSolicitud({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireBuyer();
  const supabase = await createClient();
  const { data: req } = await supabase
    .from("quote_requests")
    .select("id, folio, estado, notas, atencion, destino_entrega, created_at, submitted_at, due_at, customers(nombre), profiles:vendedor_id(nombre)")
    .eq("id", id)
    .maybeSingle();
  if (!req || req.estado !== "enviada") notFound();

  const [{ data: items }, { data: cfgRow }, { data: sup }, settings] = await Promise.all([
    supabase
      .from("quote_items")
      .select(
        "*, item_references(id, tipo, url), item_quotes(*), item_dispatch(*), item_costs(*), item_update_requests(*), item_clarification_pauses(*), item_messages(*), item_outcomes(*), item_sourcing(*), item_purchases(*)",
      )
      .eq("request_id", id)
      .order("posicion"),
    supabase.from("pricing_config").select("no_shipping_markup, p1, p2, p3, p4, p5").order("id", { ascending: false }).limit(1).single(),
    supabase.from("suppliers").select("nombre").eq("activo", true).order("nombre"),
    getBusinessSettings(supabase),
  ]);
  let rows = (await withSignedUrls(supabase, (items ?? []) as unknown as ItemRow[])) as unknown as BuyerItem[];
  rows = (await withMessageImageUrls(supabase, rows)) as BuyerItem[];
  rows = rows.map((r) => ({ ...r, item_sourcing: one(r.item_sourcing as never), item_purchases: one(r.item_purchases as never) }));

  const proveedores = (sup ?? []).map((s) => s.nombre as string);
  const factors: Factors = {
    noShippingMarkup: String(cfgRow!.no_shipping_markup),
    p1: String(cfgRow!.p1), p2: String(cfgRow!.p2), p3: String(cfgRow!.p3), p4: String(cfgRow!.p4), p5: String(cfgRow!.p5),
  };

  const now = new Date();
  const due = new Date(req.due_at!);
  const remainingByItem: Record<string, number> = {};
  const updateRemainingByItem: Record<string, number | null> = {};
  for (const r of rows) {
    const pauses = r.item_clarification_pauses ?? [];
    remainingByItem[r.id] = remainingWithPauses(due, pauses, now, settings);
    const open = r.item_update_requests?.find((u) => !u.resolved_at);
    updateRemainingByItem[r.id] = open
      ? remainingWithPauses(new Date(open.due_at), pauses.filter((p) => new Date(p.clarification_requested_at) >= new Date(open.requested_at)), now, settings)
      : null;
  }
  void businessHoursBetween;
  const anyPending = rows.some((r) => r.estado === "pendiente");
  const worst = Math.min(...Object.values(remainingByItem));

  const ids = [req.id, ...rows.map((r) => r.id)];
  const [{ data: audit }, { data: people }] = await Promise.all([
    supabase.from("audit_log").select("id, at, user_id, action, entity, entity_id").in("entity_id", ids).order("id", { ascending: false }).limit(200),
    supabase.from("profiles").select("id, nombre"),
  ]);
  const names = new Map((people ?? []).map((p) => [p.id as string, p.nombre as string]));
  const customer = req.customers as unknown as { nombre: string } | null;
  const revision = requestRevision(rows);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/comprador" className="text-sm text-slate-600 hover:underline">Pendientes</Link>
        <span className="text-slate-400">/</span>
        <h1 className="text-xl font-semibold tracking-tight">{revisionFolio(req.folio!, revision)}</h1>
        <span className="text-sm text-slate-600">{customer?.nombre}</span>
        <span className="text-sm text-slate-500">Vendedor: {(req.profiles as unknown as { nombre: string } | null)?.nombre}</span>
        {anyPending && <SemaforoBadge remaining={worst} />}
      </div>
      {(req.atencion || req.destino_entrega) && (
        <p className="text-sm text-slate-600">
          {req.atencion && <>Atención: {req.atencion}. </>}
          {req.destino_entrega && <>Destino de entrega: {req.destino_entrega}.</>}
        </p>
      )}
      {req.notas && <p className="text-sm text-slate-600">Notas: {req.notas}</p>}
      {rows.map((item) => (
        <BuyerItemCard
          key={item.id}
          item={item}
          requestId={req.id}
          factors={factors}
          proveedores={proveedores}
          remaining={remainingByItem[item.id]}
          updateRemaining={updateRemainingByItem[item.id]}
          nowIso={now.toISOString()}
        />
      ))}
      <Timeline events={buildTimeline({ folio: req.folio!, created_at: req.created_at, submitted_at: req.submitted_at, due_at: req.due_at }, rows)} />
      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Bitácora de auditoría ({(audit ?? []).length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-700">
            {(audit ?? []).map((a) => (
              <li key={a.id}>
                {new Date(a.at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "medium" })} - {a.user_id ? (names.get(a.user_id) ?? "usuario") : "sistema"}{" "}
                {auditActionLabel(a.action)} ({a.entity})
              </li>
            ))}
          </ul>
        </details>
      </Card>
    </div>
  );
}
