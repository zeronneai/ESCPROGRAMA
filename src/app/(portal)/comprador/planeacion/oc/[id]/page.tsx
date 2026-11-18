import Link from "next/link";
import { notFound } from "next/navigation";
import { OcDetalle, type LineaOc } from "@/components/planeacion/oc-detalle";
import { requireBuyer } from "@/lib/auth/guards";
import type { EstadoOc } from "@/lib/planeacion";
import { hoyMx } from "@/lib/planeacion-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OcPlaneacionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireBuyer();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: oc } = await supabase
    .from("plan_ocs")
    .select("id, folio, fecha, estado, llegada_estimada, recibida_fecha, proforma_path, proforma_nombre, notas, origen, proveedor_id, plan_proveedores(id, nombre, origen, recibe_parcial, entrega_dias, contenedor_cbm, tope_usd)")
    .eq("id", id)
    .maybeSingle();
  if (!oc) notFound();
  const prov = oc.plan_proveedores as unknown as { id: string; nombre: string; origen: "china" | "usa"; recibe_parcial: boolean; entrega_dias: number; contenedor_cbm: number | null; tope_usd: number | null };
  const [{ data: ls }, { data: arts }] = await Promise.all([
    supabase.from("plan_oc_lineas").select("id, clave, cantidad, cantidad_proforma, recibido, recibido_fecha, precio").eq("oc_id", id).order("clave"),
    supabase.from("plan_articulos").select("clave, nombre, empaque, cbm_empaque, precio, codigo_proveedor").eq("proveedor_id", oc.proveedor_id).order("clave"),
  ]);
  const porClave = new Map((arts ?? []).map((a) => [a.clave, a]));
  const lineas: LineaOc[] = (ls ?? []).map((l) => {
    const a = porClave.get(l.clave);
    return {
      id: l.id,
      clave: l.clave,
      nombre: a?.nombre ?? "",
      cantidad: Number(l.cantidad),
      cantidad_proforma: l.cantidad_proforma == null ? null : Number(l.cantidad_proforma),
      recibido: Number(l.recibido),
      recibido_fecha: l.recibido_fecha,
      precio: l.precio == null ? null : Number(l.precio),
      empaque: a?.empaque == null ? null : Number(a.empaque),
      cbm_empaque: a?.cbm_empaque == null ? null : Number(a.cbm_empaque),
    };
  });
  let proformaUrl: string | null = null;
  if (oc.proforma_path) {
    const { data: s } = await supabase.storage.from("compras").createSignedUrl(oc.proforma_path, 600);
    proformaUrl = s?.signedUrl ?? null;
  }
  return (
    <div className="space-y-4">
      <Link href={`/comprador/planeacion?p=${prov.id}`} className="text-sm text-brand-700 underline">← Planeación de {prov.nombre}</Link>
      <OcDetalle
        oc={{ id: oc.id, folio: oc.folio, fecha: oc.fecha, estado: oc.estado as EstadoOc, llegada_estimada: oc.llegada_estimada, recibida_fecha: oc.recibida_fecha, notas: oc.notas, origen: oc.origen, proforma_nombre: oc.proforma_nombre }}
        prov={{ ...prov, contenedor_cbm: prov.contenedor_cbm == null ? null : Number(prov.contenedor_cbm), tope_usd: prov.tope_usd == null ? null : Number(prov.tope_usd) }}
        lineas={lineas}
        catalogo={(arts ?? []).map((a) => ({ clave: a.clave, nombre: a.nombre, precio: a.precio == null ? null : Number(a.precio) }))}
        proformaUrl={proformaUrl}
        hoy={hoyMx()}
      />
    </div>
  );
}
