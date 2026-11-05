import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Abre el PDF (o descarga el XML) de la factura de una entrega. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  const xml = new URL(req.url).searchParams.get("tipo") === "xml";
  const supabase = await createClient();
  const { data } = await supabase.from("salidas").select("factura_path, factura_nombre, xml_path, folio_factura").eq("id", id).maybeSingle();
  const path = xml ? data?.xml_path : data?.factura_path;
  if (!data || !path) return NextResponse.json({ error: "sin_archivo" }, { status: 404 });
  const { data: s } = await supabase.storage.from("facturas").createSignedUrl(path, 300, xml ? { download: `${data.folio_factura}.xml` } : undefined);
  if (!s?.signedUrl) return NextResponse.json({ error: "sin_archivo" }, { status: 404 });
  return NextResponse.redirect(s.signedUrl);
}
