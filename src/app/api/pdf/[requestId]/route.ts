import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { buildPdfModel, PdfNotReadyError, pdfFileName, toPdfQuote } from "@/lib/pdf/model";
import { resolvePdfName } from "@/lib/pdf/names";
import { planFromStored } from "@/lib/pdf/shipping";
import { renderQuotePdf } from "@/lib/pdf/render";
import { getBusinessSettings, getCompanyProfile } from "@/lib/quotes/server";
import { requestRevision } from "@/lib/quotes/revisions";
import { latestQuote, type ItemRow } from "@/lib/quotes/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDF de cotizacion para el cliente. Solo incluye el precio que el vendedor eligio por partida:
 * nunca los 5 precios, costos, costo de envio del proveedor, base ni porcentajes.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const user = await getSessionUser();
  if (!user || user.must_change_password) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  if (!z.string().uuid().safeParse(requestId).success) return NextResponse.json({ error: "solicitud_invalida" }, { status: 400 });

  const supabase = await createClient();
  const { data: req } = await supabase
    .from("quote_requests")
    .select("id, folio, estado, vendedor_id, atencion, destino_entrega, customers(nombre), profiles:vendedor_id(nombre)")
    .eq("id", requestId)
    .maybeSingle();
  if (!req || req.estado !== "enviada") return NextResponse.json({ error: "no_encontrada" }, { status: 404 });

  const [{ data: items }, cfg, company] = await Promise.all([
    supabase
      .from("quote_items")
      .select("id, folio, producto, cantidad, unidad, talla, posicion, item_quotes(*), item_price_choice(*)")
      .eq("request_id", requestId)
      .order("posicion"),
    getBusinessSettings(supabase),
    getCompanyProfile(supabase),
  ]);
  const rows = (items ?? []) as unknown as Array<ItemRow & { item_price_choice: { quote_version: number; precio: number }[] }>;
  const revision = requestRevision(rows);
  const { data: pdfData } = await supabase
    .from("quote_pdf_data")
    .select("destino_entrega, via_envio, condiciones, atencion, envio_modo, envio_monto, envio_moneda")
    .eq("request_id", requestId)
    .eq("revision", revision)
    .maybeSingle();
  const { data: shipItems } = await supabase
    .from("quote_pdf_shipping_items")
    .select("item_id, monto, tipo")
    .eq("request_id", requestId)
    .eq("revision", revision);

  // Nombre en el PDF de la version vigente de cada partida (la descripcion y el uso son internos y nunca salen).
  const { data: nameRows } = await supabase.from("item_pdf_names").select("item_id, quote_version, nombre").in("item_id", rows.map((r) => r.id));
  try {
    const model = buildPdfModel({
      company: { ...company, pie_lineas: company.pie_lineas },
      folio: req.folio!,
      customerName: (req.customers as unknown as { nombre: string } | null)?.nombre ?? "",
      vendedorNombre: (req.profiles as unknown as { nombre: string } | null)?.nombre ?? "",
      items: rows
        .map((i) => ({ i, q: latestQuote(i) }))
        .filter(({ q }) => !!q)
        .map(({ i, q }) => ({
          id: i.id,
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
      },
      now: new Date(),
      timezone: cfg.timezone,
    });
    const buffer = await renderQuotePdf(model);
    // Bitacora: solo metadatos, nunca el contenido del PDF.
    await supabase.rpc("log_event", {
      p_action: "download_pdf",
      p_entity: "quote_requests",
      p_entity_id: requestId,
      p_meta: { revision, partidas: model.rows.length },
    });
    const name = pdfFileName(req.folio!, (req.customers as unknown as { nombre: string } | null)?.nombre ?? "");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof PdfNotReadyError) return NextResponse.json({ error: "pdf_no_disponible", problems: e.problems }, { status: 409 });
    throw e;
  }
}
