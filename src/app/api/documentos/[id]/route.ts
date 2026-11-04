import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Abre el PDF de un documento (liga temporal). La base valida que el usuario este activo. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("documentos").select("path, nombre_archivo").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  const descargar = new URL(req.url).searchParams.has("descargar");
  const { data: s } = await supabase.storage.from("documentos").createSignedUrl(data.path, 300, descargar ? { download: data.nombre_archivo } : undefined);
  if (!s?.signedUrl) return NextResponse.json({ error: "sin_archivo" }, { status: 404 });
  return NextResponse.redirect(s.signedUrl);
}
