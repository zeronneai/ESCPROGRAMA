import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPdfModel, toPdfQuote, type PdfModel } from "@/lib/pdf/model";
import { resolvePdfName } from "@/lib/pdf/names";
import { aparteFromStored, planFromStored, storedPresentation } from "@/lib/pdf/shipping";
import { getBusinessSettings, getCompanyProfile } from "@/lib/quotes/server";
import { issueNumber, requestRevision } from "@/lib/quotes/revisions";
import { latestQuote, type ItemRow } from "@/lib/quotes/types";

export interface IssueRow {
  id: string;
  request_id: string;
  revision: number;
  secuencia: number;
  numero: string;
  snapshot: PdfModel;
  renegociacion_id: string | null;
  emitida_por: string;
  emitida_at: string;
}

export interface EmissionState {
  revision: number;
  /** Emisiones de la revision vigente, la mas reciente primero. */
  issues: IssueRow[];
  renegotiationOpen: boolean;
  /** Partidas cotizadas que aun no se envian (estado cotizada). */
  unsent: number;
  /** Numero que tendra la siguiente emision. */
  nextNumero: string;
  /** Hay algo que registrar como enviado (nuevo numero). */
  canIssue: boolean;
}

export async function emissionState(
  supabase: SupabaseClient,
  request: { id: string; folio: string },
  items: Array<Pick<ItemRow, "estado" | "item_quotes">>,
): Promise<EmissionState> {
  const revision = requestRevision(items);
  const [{ data: issues }, { data: reneg }] = await Promise.all([
    supabase
      .from("quote_issues")
      .select("id, request_id, revision, secuencia, numero, snapshot, renegociacion_id, emitida_por, emitida_at")
      .eq("request_id", request.id)
      .eq("revision", revision)
      .order("secuencia", { ascending: false }),
    supabase.from("quote_renegotiations").select("id").eq("request_id", request.id).is("cerrada_at", null).limit(1),
  ]);
  const list = (issues ?? []) as IssueRow[];
  const renegotiationOpen = (reneg ?? []).length > 0;
  const unsent = items.filter((i) => i.estado === "cotizada" && latestQuote(i)).length;
  const quoted = items.filter((i) => latestQuote(i)).length;
  return {
    revision,
    issues: list,
    renegotiationOpen,
    unsent,
    nextNumero: issueNumber(request.folio, revision, (list[0]?.secuencia ?? 0) + 1),
    canIssue: quoted > 0 && (unsent > 0 || renegotiationOpen || list.length === 0),
  };
}

/** Modelo del PDF con lo que hay ahora (precios elegidos, datos del PDF y envio guardados). Lanza PdfNotReadyError. */
export async function buildLiveQuoteModel(supabase: SupabaseClient, requestId: string, numero?: string): Promise<{ model: PdfModel; revision: number } | null> {
  const { data: req } = await supabase
    .from("quote_requests")
    .select("id, folio, estado, vendedor_id, atencion, destino_entrega, customers(nombre), profiles:vendedor_id(nombre)")
    .eq("id", requestId)
    .maybeSingle();
  if (!req || req.estado !== "enviada") return null;

  const [{ data: items }, cfg, company] = await Promise.all([
    supabase
      .from("quote_items")
      .select("id, folio, producto, cantidad, unidad, talla, posicion, estado, item_quotes(*), item_price_choice(*)")
      .eq("request_id", requestId)
      .order("posicion"),
    getBusinessSettings(supabase),
    getCompanyProfile(supabase),
  ]);
  const rows = (items ?? []) as unknown as Array<ItemRow & { item_price_choice: { quote_version: number; precio: number }[] }>;
  const revision = requestRevision(rows);
  const [{ data: pdfData }, { data: shipItems }, { data: minChoices }, { data: nameRows }] = await Promise.all([
    supabase
      .from("quote_pdf_data")
      .select("destino_entrega, via_envio, condiciones, atencion, envio_modo, envio_monto, envio_moneda, envio_presentacion, envio_aparte_monto, envio_aparte_moneda")
      .eq("request_id", requestId)
      .eq("revision", revision)
      .maybeSingle(),
    supabase.from("quote_pdf_shipping_items").select("item_id, monto, tipo").eq("request_id", requestId).eq("revision", revision),
    supabase.from("quote_pdf_min_choices").select("item_id, decision").eq("request_id", requestId).eq("revision", revision),
    // Nombre en el PDF de la version vigente de cada partida (la descripcion y el uso son internos y nunca salen).
    supabase.from("item_pdf_names").select("item_id, quote_version, nombre").in("item_id", rows.map((r) => r.id)),
  ]);

  const model = buildPdfModel({
    company: { ...company, pie_lineas: company.pie_lineas },
    folio: req.folio!,
    numero,
    customerName: (req.customers as unknown as { nombre: string } | null)?.nombre ?? "",
    vendedorNombre: (req.profiles as unknown as { nombre: string } | null)?.nombre ?? "",
    items: rows
      .map((i) => ({ i, q: latestQuote(i) }))
      .filter(({ q }) => !!q)
      .map(({ i, q }) => ({
        id: i.id,
        decisionMin: (minChoices ?? []).find((c) => c.item_id === i.id)?.decision as "cotizar_minimo" | "mantener_pedida" | undefined,
        folio: i.folio!,
        producto: i.producto,
        nombre: resolvePdfName((nameRows ?? []).find((n) => n.item_id === i.id && n.quote_version === q!.version)?.nombre, q!.alt_nombre, i.producto),
        cantidad: i.cantidad,
        unidad: i.unidad,
        talla: i.talla,
        quote: toPdfQuote(q!),
        precioElegido: i.item_price_choice?.find((c) => c.quote_version === q!.version)?.precio ?? null,
      })),
    data: {
      condiciones: pdfData?.condiciones ?? company.condiciones_default,
      atencion: pdfData?.atencion ?? req.atencion ?? null,
      destino_entrega: pdfData?.destino_entrega ?? req.destino_entrega ?? null,
      via_envio: pdfData?.via_envio ?? null,
      envio: planFromStored(pdfData, shipItems ?? []),
      envioAparte: aparteFromStored(pdfData),
      presentacion: storedPresentation(pdfData),
    },
    now: new Date(),
    timezone: cfg.timezone,
  });
  return { model, revision };
}
