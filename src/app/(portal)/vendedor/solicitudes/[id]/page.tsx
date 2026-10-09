import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { getBusinessSettings, withSignedUrls } from "@/lib/quotes/server";
import type { ItemRow } from "@/lib/quotes/types";
import { createClient } from "@/lib/supabase/server";
import { businessHoursBetween } from "@/lib/time/business-hours";
import { SellerRequestView } from "./seller-request-view";
import { Timeline } from "@/components/timeline";
import { buildTimeline } from "@/lib/stats/timeline";

export default async function DetalleSolicitud({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();
  const { data: req } = await supabase
    .from("quote_requests")
    .select("id, folio, estado, notas, created_at, submitted_at, due_at, vendedor_id, customers(nombre, tipo)")
    .eq("id", id)
    .maybeSingle();
  if (!req || req.vendedor_id !== user.id) notFound();
  if (req.estado === "borrador") redirect(`/vendedor/solicitudes/${id}/editar`);

  const [{ data: items }, cfg] = await Promise.all([
    supabase
      .from("quote_items")
      .select("*, item_references(id, tipo, url), item_quotes(*), item_dispatch(*)")
      .eq("request_id", id)
      .order("posicion"),
    getBusinessSettings(supabase),
  ]);
  const withUrls = await withSignedUrls(supabase, (items ?? []) as unknown as ItemRow[]);
  const now = new Date();
  const due = req.due_at ? new Date(req.due_at) : null;

  return (
    <div className="space-y-4">
    <SellerRequestView
      request={{
        id: req.id,
        folio: req.folio!,
        notas: req.notas,
        cliente: (req.customers as unknown as { nombre: string; tipo: string } | null)?.nombre ?? "",
        remaining: due ? businessHoursBetween(now, due, cfg) : null,
        dueAt: req.due_at,
      }}
      items={withUrls}
    />
    <Timeline events={buildTimeline({ folio: req.folio!, created_at: req.created_at, submitted_at: req.submitted_at, due_at: req.due_at }, withUrls)} />
    </div>
  );
}
