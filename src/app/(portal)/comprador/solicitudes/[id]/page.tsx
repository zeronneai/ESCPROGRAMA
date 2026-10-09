import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBuyer } from "@/lib/auth/guards";
import { getBusinessSettings, withSignedUrls } from "@/lib/quotes/server";
import type { ItemRow } from "@/lib/quotes/types";
import { createClient } from "@/lib/supabase/server";
import { businessHoursBetween } from "@/lib/time/business-hours";
import { SemaforoBadge } from "@/components/status";
import { Card } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { auditActionLabel, buildTimeline } from "@/lib/stats/timeline";
import { BuyerItemCard, type CostRow, type Factors } from "./buyer-item-card";

export default async function CompradorSolicitud({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireBuyer();
  const supabase = await createClient();
  const { data: req } = await supabase
    .from("quote_requests")
    .select("id, folio, estado, notas, created_at, submitted_at, due_at, customers(nombre, tipo), profiles:vendedor_id(nombre)")
    .eq("id", id)
    .maybeSingle();
  if (!req || req.estado !== "enviada") notFound();

  const [{ data: items }, { data: cfgRow }, { data: provs }, settings] = await Promise.all([
    supabase
      .from("quote_items")
      .select("*, item_references(id, tipo, url), item_quotes(*), item_dispatch(*), item_costs(*)")
      .eq("request_id", id)
      .order("posicion"),
    supabase.from("pricing_config").select("no_shipping_markup, p1, p2, p3, p4, p5").order("id", { ascending: false }).limit(1).single(),
    supabase.from("item_costs").select("proveedor").not("proveedor", "is", null),
    getBusinessSettings(supabase),
  ]);
  const rows = (await withSignedUrls(supabase, (items ?? []) as unknown as ItemRow[])) as unknown as Array<ItemRow & { item_costs: CostRow[] }>;
  const proveedores = [...new Set((provs ?? []).map((p) => p.proveedor as string))].sort();
  const factors: Factors = {
    noShippingMarkup: String(cfgRow!.no_shipping_markup),
    p1: String(cfgRow!.p1),
    p2: String(cfgRow!.p2),
    p3: String(cfgRow!.p3),
    p4: String(cfgRow!.p4),
    p5: String(cfgRow!.p5),
  };
  const due = new Date(req.due_at!);
  const remaining = businessHoursBetween(new Date(), due, settings);
  const ids = [req.id, ...rows.map((r) => r.id)];
  const [{ data: audit }, { data: people }] = await Promise.all([
    supabase.from("audit_log").select("id, at, user_id, action, entity, entity_id").in("entity_id", ids).order("id", { ascending: false }).limit(200),
    supabase.from("profiles").select("id, nombre"),
  ]);
  const names = new Map((people ?? []).map((p) => [p.id as string, p.nombre as string]));
  const pend = rows.some((r) => r.estado === "pendiente");
  const customer = req.customers as unknown as { nombre: string; tipo: string } | null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/comprador" className="text-sm text-slate-600 hover:underline">
          Pendientes
        </Link>
        <span className="text-slate-400">/</span>
        <h1 className="text-lg font-semibold">{req.folio}</h1>
        <span className="text-sm text-slate-600">
          {customer?.nombre} ({customer?.tipo})
        </span>
        <span className="text-sm text-slate-500">Vendedor: {(req.profiles as unknown as { nombre: string } | null)?.nombre}</span>
        {pend && <SemaforoBadge remaining={remaining} />}
      </div>
      {req.notas && <p className="text-sm text-slate-600">Notas: {req.notas}</p>}
      {rows.map((item) => (
        <BuyerItemCard key={item.id} item={item} factors={factors} proveedores={proveedores} requestOverdue={remaining <= 0} />
      ))}
      <Timeline events={buildTimeline({ folio: req.folio, created_at: req.created_at, submitted_at: req.submitted_at, due_at: req.due_at }, rows)} />
      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Bitacora de auditoria ({(audit ?? []).length})</summary>
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
