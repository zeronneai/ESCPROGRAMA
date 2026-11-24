import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Abre el PDF del estado de cuenta (finanzas y jefa de ventas). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("conciliaciones").select("archivo_path").eq("id", id).maybeSingle();
  if (!data?.archivo_path) return NextResponse.json({ error: "sin_archivo" }, { status: 404 });
  const { data: s } = await supabase.storage.from("conciliaciones").createSignedUrl(data.archivo_path, 300);
  if (!s?.signedUrl) return NextResponse.json({ error: "sin_permiso" }, { status: 403 });
  return NextResponse.redirect(s.signedUrl);
}
