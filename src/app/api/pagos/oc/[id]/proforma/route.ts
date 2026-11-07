import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Abre el documento de la proforma de una OC (liga temporal). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("ordenes_compra").select("proforma_path").eq("id", id).maybeSingle();
  if (!data?.proforma_path) return NextResponse.json({ error: "sin_archivo" }, { status: 404 });
  const { data: s } = await supabase.storage.from("pagos").createSignedUrl(data.proforma_path, 300);
  if (!s?.signedUrl) return NextResponse.json({ error: "sin_archivo" }, { status: 404 });
  return NextResponse.redirect(s.signedUrl);
}
