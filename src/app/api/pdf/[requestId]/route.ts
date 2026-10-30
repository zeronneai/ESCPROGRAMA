import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { PdfNotReadyError, pdfFileName, type PdfModel } from "@/lib/pdf/model";
import { renderQuotePdf } from "@/lib/pdf/render";
import { buildLiveQuoteModel, emissionState, type IssueRow } from "@/lib/pdf/server";
import type { ItemRow } from "@/lib/quotes/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDF de cotizacion para el cliente. Solo incluye el precio que el vendedor eligio por partida:
 * nunca los 5 precios, costos, costo de envio del proveedor, base ni porcentajes.
 *
 * - ?emision=<id>: el PDF EXACTO de una cotizacion ya enviada (copia fija, con su numero).
 * - Sin parametro: si hay algo por enviar (partidas nuevas o recotizacion abierta), el PDF con lo actual y el
 *   numero que tendra al registrarse; si no, el de la ultima cotizacion enviada.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const user = await getSessionUser();
  if (!user || user.must_change_password) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  if (!z.string().uuid().safeParse(requestId).success) return NextResponse.json({ error: "solicitud_invalida" }, { status: 400 });
  const emisionParam = req.nextUrl.searchParams.get("emision");
  if (emisionParam && !z.string().uuid().safeParse(emisionParam).success) return NextResponse.json({ error: "emision_invalida" }, { status: 400 });

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("quote_requests")
    .select("id, folio, estado, customers(nombre)")
    .eq("id", requestId)
    .maybeSingle();
  if (!request || request.estado !== "enviada") return NextResponse.json({ error: "no_encontrada" }, { status: 404 });
  const customer = (request.customers as unknown as { nombre: string } | null)?.nombre ?? "";

  let model: PdfModel;
  let emision: string | null = null;
  try {
    if (emisionParam) {
      const { data: issue } = await supabase
        .from("quote_issues")
        .select("id, numero, snapshot")
        .eq("id", emisionParam)
        .eq("request_id", requestId)
        .maybeSingle();
      if (!issue) return NextResponse.json({ error: "no_encontrada" }, { status: 404 });
      model = issue.snapshot as PdfModel;
      emision = issue.id;
    } else {
      const { data: items } = await supabase.from("quote_items").select("estado, item_quotes(version, valid_until)").eq("request_id", requestId);
      const state = await emissionState(supabase, { id: request.id, folio: request.folio! }, (items ?? []) as unknown as ItemRow[]);
      const last: IssueRow | undefined = state.issues[0];
      if (!state.canIssue && last) {
        model = last.snapshot;
        emision = last.id;
      } else {
        const live = await buildLiveQuoteModel(supabase, requestId, state.nextNumero);
        if (!live) return NextResponse.json({ error: "no_encontrada" }, { status: 404 });
        model = live.model;
      }
    }
    const buffer = await renderQuotePdf(model);
    // Bitacora: solo metadatos, nunca el contenido del PDF.
    await supabase.rpc("log_event", {
      p_action: "download_pdf",
      p_entity: "quote_requests",
      p_entity_id: requestId,
      p_meta: { numero: model.folio, emision, partidas: model.rows.length },
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${pdfFileName(model.folio, customer)}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof PdfNotReadyError) return NextResponse.json({ error: "pdf_no_disponible", problems: e.problems }, { status: 409 });
    throw e;
  }
}
