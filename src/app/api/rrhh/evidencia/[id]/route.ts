import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Abre la evidencia de una solicitud (el colaborador, su jefe y la gerente). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("rrhh_solicitudes").select("evidencia_path").eq("id", id).maybeSingle();
  if (!data?.evidencia_path) return NextResponse.json({ error: "sin_archivo" }, { status: 404 });
  const { data: s } = await supabase.storage.from("rrhh").createSignedUrl(data.evidencia_path, 300);
  if (!s?.signedUrl) return NextResponse.json({ error: "sin_permiso" }, { status: 403 });
  return NextResponse.redirect(s.signedUrl);
}
