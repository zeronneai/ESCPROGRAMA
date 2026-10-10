import { notFound, redirect } from "next/navigation";
import { Timeline } from "@/components/timeline";
import { requireUser } from "@/lib/auth/guards";
import { requestRevision } from "@/lib/quotes/revisions";
import { getBusinessSettings, getCompanyProfile, withMessageImageUrls, withSignedUrls } from "@/lib/quotes/server";
import { effectiveDueAt, remainingWithPauses } from "@/lib/quotes/clock";
import { latestQuote, type ItemRow } from "@/lib/quotes/types";
import { itemCurrencies } from "@/lib/pdf/model";
import { shippingDefaults } from "@/lib/pdf/shipping";
import { buildTimeline } from "@/lib/stats/timeline";
import { createClient } from "@/lib/supabase/server";
import { SellerRequestView } from "./seller-request-view";

export default async function DetalleSolicitud({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();
  const { data: req } = await supabase
    .from("quote_requests")
    .select("id, folio, estado, notas, atencion, destino_entrega, created_at, submitted_at, due_at, vendedor_id, customers(nombre)")
    .eq("id", id)
    .maybeSingle();
  if (!req || req.vendedor_id !== user.id) notFound();
  if (req.estado === "borrador") redirect(`/vendedor/solicitudes/${id}/editar`);

  const [{ data: items }, cfg, company] = await Promise.all([
    supabase
      .from("quote_items")
      .select(
        "*, item_references(id, tipo, url), item_quotes(*), item_dispatch(*), item_update_requests(*), item_clarification_pauses(*), item_messages(*), item_outcomes(*), item_price_choice(*)",
      )
      .eq("request_id", id)
      .order("posicion"),
    getBusinessSettings(supabase),
    getCompanyProfile(supabase),
  ]);
  let rows = (await withSignedUrls(supabase, (items ?? []) as unknown as ItemRow[])) as ItemRow[];
  rows = await withMessageImageUrls(supabase, rows);

  const revision = requestRevision(rows);
  // Datos del PDF de esta revision; si aun no hay, se parte de la ultima revision guardada (el vendedor la confirma al descargar).
  const { data: pdfRows } = await supabase
    .from("quote_pdf_data")
    .select("revision, destino_entrega, via_envio, condiciones, atencion, envio_modo, envio_monto, envio_moneda")
    .eq("request_id", id)
    .lte("revision", revision)
    .order("revision", { ascending: false })
    .limit(1);
  const pdfData = pdfRows?.[0] ?? null;
  const { data: shipRows } = pdfData
    ? await supabase.from("quote_pdf_shipping_items").select("item_id, monto, tipo").eq("request_id", id).eq("revision", pdfData.revision)
    : { data: [] };

  const currencies = itemCurrencies(rows.map((r) => ({ quote: latestQuote(r) })));
  const now = new Date();
  const due = req.due_at ? new Date(req.due_at) : null;
  // Plazo del comprador por partida, con las pausas por aclaracion descontadas.
  const remainingByItem: Record<string, number | null> = {};
  for (const i of rows) {
    remainingByItem[i.id] = due ? remainingWithPauses(due, i.item_clarification_pauses ?? [], now, cfg) : null;
  }
  void effectiveDueAt;

  return (
    <div className="space-y-4">
      <SellerRequestView
        request={{
          id: req.id,
          folio: req.folio!,
          notas: req.notas,
          cliente: (req.customers as unknown as { nombre: string } | null)?.nombre ?? "",
          atencion: req.atencion ?? "",
          destino: req.destino_entrega ?? "",
          revision,
        }}
        items={rows}
        remainingByItem={remainingByItem}
        pdfDefaults={{
          destino: pdfData?.destino_entrega ?? req.destino_entrega ?? "",
          via: pdfData?.via_envio ?? "",
          condiciones: pdfData?.condiciones ?? company.condiciones_default,
          atencion: pdfData?.atencion ?? req.atencion ?? "",
          ...shippingDefaults(pdfData, shipRows ?? [], currencies),
        }}
        nowIso={now.toISOString()}
      />
      <Timeline events={buildTimeline({ folio: req.folio!, created_at: req.created_at, submitted_at: req.submitted_at, due_at: req.due_at }, rows)} />
    </div>
  );
}
