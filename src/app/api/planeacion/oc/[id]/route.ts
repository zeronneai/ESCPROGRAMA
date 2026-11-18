import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { createElement } from "react";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { OcDocument, type OcPdfModel } from "@/lib/pdf/oc-template";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PDF de la Purchase Order (formato de ESC) de una OC de planeacion. Solo el comprador. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || user.must_change_password) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  if (user.rol !== "comprador") return NextResponse.json({ error: "sin_permiso" }, { status: 403 });
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "oc_invalida" }, { status: 400 });
  const supabase = await createClient();
  const { data: oc } = await supabase
    .from("plan_ocs")
    .select("folio, fecha, proveedor_id, plan_proveedores(nombre, razon_social, contacto, enviar_a)")
    .eq("id", id)
    .maybeSingle();
  if (!oc) return NextResponse.json({ error: "no_encontrada" }, { status: 404 });
  const prov = oc.plan_proveedores as unknown as { nombre: string; razon_social: string | null; contacto: string | null; enviar_a: string | null };
  const [{ data: ls }, { data: arts }] = await Promise.all([
    supabase.from("plan_oc_lineas").select("clave, cantidad, cantidad_proforma, precio").eq("oc_id", id).order("clave"),
    supabase.from("plan_articulos").select("clave, nombre, codigo_proveedor, descripcion_proveedor").eq("proveedor_id", oc.proveedor_id),
  ]);
  const porClave = new Map((arts ?? []).map((a) => [a.clave, a]));
  const model: OcPdfModel = {
    folio: oc.folio,
    fecha: oc.fecha,
    proveedor: prov.razon_social || prov.nombre,
    contacto: prov.contacto,
    enviarA: prov.enviar_a,
    firma: "Jose Luis Amaya",
    lineas: (ls ?? []).map((l) => {
      const a = porClave.get(l.clave);
      return {
        modelo: a?.codigo_proveedor || l.clave.replace(/^ESC-/, ""),
        producto: a?.descripcion_proveedor || a?.nombre || l.clave,
        cantidad: Number(l.cantidad_proforma ?? l.cantidad),
        precio: l.precio == null ? null : Number(l.precio),
      };
    }),
  };
  let logo: Buffer | undefined;
  try {
    logo = await readFile(path.join(process.cwd(), "public", "logo-esc.png"));
  } catch {
    logo = undefined;
  }
  const pdf = await renderToBuffer(createElement(OcDocument, { m: model, logoSrc: logo }) as never);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="PO_${oc.folio.replace(/[^\w-]/g, "")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
