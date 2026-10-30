import { notFound, redirect } from "next/navigation";
import { Timeline } from "@/components/timeline";
import { requireUser } from "@/lib/auth/guards";
import { requestRevision } from "@/lib/quotes/revisions";
import { getBusinessSettings, getCompanyProfile, withMessageImageUrls, withSignedUrls } from "@/lib/quotes/server";
import { remainingWithPauses } from "@/lib/quotes/clock";
import { latestQuote, type ItemRow } from "@/lib/quotes/types";
import { defaultPdfName, resolvePdfName } from "@/lib/pdf/names";
import { itemCurrencies } from "@/lib/pdf/model";
import { emissionState } from "@/lib/pdf/server";
import { presentationDefaults, shippingDefaults } from "@/lib/pdf/shipping";
import { buildTimeline, emissionEvents } from "@/lib/stats/timeline";
import { createClient } from "@/lib/supabase/server";
import { SellerRequestView, type IssueView } from "./seller-request-view";

export default async function DetalleSolicitud({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();
  const { data: req } = await supabase
    .from("quote_requests")
    .select(
      "id, folio, estado, notas, atencion, destino_entrega, created_at, submitted_at, due_at, vendedor_id, customer_id, customers(id, nombre, razon_social, rfc, direccion, contacto_nombre, contacto_correo, contacto_telefono)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!req || req.vendedor_id !== user.id) notFound();
  if (req.estado === "borrador") redirect(`/vendedor/solicitudes/${id}/editar`);

  const [{ data: items }, cfg, company, { data: allIssues }, { data: renegs }] = await Promise.all([
    supabase
      .from("quote_items")
      .select(
        "*, item_references(id, tipo, url), item_quotes(*), item_dispatch(*), item_update_requests(*), item_clarification_pauses(*), item_messages(*), item_outcomes(*), item_price_choice(*)",
      )
      .eq("request_id", id)
      .order("posicion"),
    getBusinessSettings(supabase),
    getCompanyProfile(supabase),
    supabase
      .from("quote_issues")
      .select("id, numero, revision, secuencia, emitida_at, renegociacion_id, snapshot, quote_issue_sends(id, medio, destinatario, nota, enviado_at)")
      .eq("request_id", id)
      .order("emitida_at", { ascending: false }),
    supabase.from("quote_renegotiations").select("id, motivo, abierta_at, cerrada_at, cancelada, issue_id").eq("request_id", id).order("abierta_at"),
  ]);
  let rows = (await withSignedUrls(supabase, (items ?? []) as unknown as ItemRow[])) as ItemRow[];
  rows = await withMessageImageUrls(supabase, rows);

  const revision = requestRevision(rows);
  const state = await emissionState(supabase, { id: req.id, folio: req.folio! }, rows);
  // Datos del PDF de esta revision; si aun no hay, se parte de la ultima revision guardada (el vendedor la confirma al guardar).
  const { data: pdfRows } = await supabase
    .from("quote_pdf_data")
    .select("revision, destino_entrega, via_envio, condiciones, atencion, envio_modo, envio_monto, envio_moneda, envio_presentacion, envio_aparte_monto, envio_aparte_moneda")
    .eq("request_id", id)
    .lte("revision", revision)
    .order("revision", { ascending: false })
    .limit(1);
  const pdfData = pdfRows?.[0] ?? null;
  const { data: shipRows } = pdfData
    ? await supabase.from("quote_pdf_shipping_items").select("item_id, monto, tipo").eq("request_id", id).eq("revision", pdfData.revision)
    : { data: [] };

  const { data: minRows } = await supabase.from("quote_pdf_min_choices").select("item_id, decision").eq("request_id", id).eq("revision", revision);
  const minimos: Record<string, "cotizar_minimo" | "mantener_pedida"> = {};
  for (const m of minRows ?? []) minimos[m.item_id] = m.decision as "cotizar_minimo" | "mantener_pedida";

  // Nombre en el PDF por partida: el guardado para la version vigente, o el del alternativo cotizado, o el producto.
  const { data: nameRows } = await supabase.from("item_pdf_names").select("item_id, quote_version, nombre").in("item_id", rows.map((r) => r.id));
  const nombreDefecto: Record<string, string> = {};
  const nombres: Record<string, string> = {};
  for (const r of rows) {
    const q = latestQuote(r);
    if (!q) continue;
    nombreDefecto[r.id] = defaultPdfName(q.alt_nombre, r.producto);
    nombres[r.id] = resolvePdfName((nameRows ?? []).find((n) => n.item_id === r.id && n.quote_version === q.version)?.nombre, q.alt_nombre, r.producto);
  }

  const currencies = itemCurrencies(rows.map((r) => ({ quote: latestQuote(r) })));
  const now = new Date();
  const due = req.due_at ? new Date(req.due_at) : null;
  // Plazo del comprador por partida, con las pausas por aclaracion descontadas.
  const remainingByItem: Record<string, number | null> = {};
  for (const i of rows) remainingByItem[i.id] = due ? remainingWithPauses(due, i.item_clarification_pauses ?? [], now, cfg) : null;

  const customer = req.customers as unknown as {
    id: string; nombre: string; razon_social: string | null; rfc: string | null; direccion: string | null;
    contacto_nombre: string | null; contacto_correo: string | null; contacto_telefono: string | null;
  } | null;
  const issues: IssueView[] = (allIssues ?? []).map((x) => {
    const snap = x.snapshot as { totals?: { currency: string; amount: string }[] };
    const reneg = (renegs ?? []).find((r) => r.issue_id === x.id);
    return {
      id: x.id,
      numero: x.numero,
      revision: x.revision,
      emitidaAt: x.emitida_at,
      totals: snap.totals ?? [],
      motivo: reneg?.motivo ?? null,
      sends: ((x.quote_issue_sends ?? []) as IssueView["sends"]).sort((a, b) => a.enviado_at.localeCompare(b.enviado_at)),
    };
  });
  const openReneg = (renegs ?? []).find((r) => !r.cerrada_at) ?? null;

  return (
    <div className="space-y-4">
      <SellerRequestView
        request={{
          id: req.id,
          folio: req.folio!,
          notas: req.notas,
          cliente: customer?.nombre ?? "",
          atencion: req.atencion ?? "",
          destino: req.destino_entrega ?? "",
          revision,
          vendedor: user.nombre,
        }}
        customer={customer}
        items={rows}
        remainingByItem={remainingByItem}
        pdfDefaults={{
          destino: pdfData?.destino_entrega ?? req.destino_entrega ?? "",
          via: pdfData?.via_envio ?? "",
          condiciones: pdfData?.condiciones ?? company.condiciones_default,
          atencion: pdfData?.atencion ?? req.atencion ?? customer?.contacto_nombre ?? "",
          ...shippingDefaults(pdfData, shipRows ?? [], currencies),
          ...presentationDefaults(pdfData),
          nombres,
          minimos,
        }}
        nombreDefecto={nombreDefecto}
        emission={{ canIssue: state.canIssue, nextNumero: state.nextNumero, unsent: state.unsent, renegotiation: openReneg ? { motivo: openReneg.motivo, abiertaAt: openReneg.abierta_at } : null }}
        issues={issues}
        nowIso={now.toISOString()}
      />
      <Timeline
        events={[
          ...buildTimeline({ folio: req.folio!, created_at: req.created_at, submitted_at: req.submitted_at, due_at: req.due_at }, rows, { skipDispatch: issues.length > 0 }),
          ...emissionEvents(issues.map((i) => ({ numero: i.numero, sends: i.sends })), renegs ?? []),
        ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())}
      />
    </div>
  );
}
