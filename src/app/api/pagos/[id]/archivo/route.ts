import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

/**
 * Abre la factura o el comprobante de un pago (liga temporal).
 * Cuando el comprador descarga el comprobante, el pago pasa al historial (ya no sale como pendiente).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  const u = await getSessionUser();
  if (!u) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo") === "factura" ? "factura" : "comprobante";
  const supabase = await createClient();
  const { data } = await supabase.from("pagos").select("estado, factura_path, factura_nombre, comprobante_path, comprobante_nombre").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  const path = tipo === "factura" ? data.factura_path : data.comprobante_path;
  const nombre = tipo === "factura" ? data.factura_nombre : data.comprobante_nombre;
  if (!path) return NextResponse.json({ error: "sin_archivo" }, { status: 404 });
  const descargar = url.searchParams.has("descargar");
  const { data: s } = await supabase.storage.from("pagos").createSignedUrl(path, 300, descargar ? { download: nombre ?? "archivo" } : undefined);
  if (!s?.signedUrl) return NextResponse.json({ error: "sin_archivo" }, { status: 404 });
  if (tipo === "comprobante" && u.rol === "comprador" && data.estado === "pagado") {
    await supabase.rpc("pago_cerrar", { p_id: id });
  }
  return NextResponse.redirect(s.signedUrl);
}
