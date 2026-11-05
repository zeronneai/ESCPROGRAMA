import Link from "next/link";
import { notFound } from "next/navigation";
import { BajaEtiqueta } from "@/components/almacen/baja-etiqueta";
import { Chip, Dl } from "@/components/ops-ui";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { ESTADO_ETIQUETA } from "@/lib/almacen";
import { fmtDate, fmtDay } from "@/lib/ops/server";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

type Et = {
  codigo: string; recibida: string; estado: keyof typeof ESTADO_ETIQUETA; salida_id: string | null; salida_at: string | null; baja_motivo: string | null; baja_at: string | null;
  articulos: { id: string; clave: string; nombre: string } | null; recepciones: { id: string; folio: string; tipo: string; orden_compra: string | null; proveedor: string | null } | null;
  recepcion_lineas: { lote: string | null } | null;
};

/** Ficha de una etiqueta: que es, cuando llego y si ya salio (rastreabilidad). */
export default async function Etiqueta({ params }: { params: Promise<{ codigo: string }> }) {
  const u = await requireUser();
  const { codigo } = await params;
  const cod = decodeURIComponent(codigo).toUpperCase();
  if (!/^E-\d{4,}$/.test(cod)) notFound();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data } = await supabase
    .from("etiquetas")
    .select("codigo, recibida, estado, salida_id, salida_at, baja_motivo, baja_at, articulos(id, clave, nombre), recepciones(id, folio, tipo, orden_compra, proveedor), recepcion_lineas(lote)")
    .eq("codigo", cod)
    .maybeSingle();
  if (!data) notFound();
  const e = data as unknown as Et;
  const { data: sal } = e.salida_id ? await supabase.from("salidas").select("id, folio_factura, cliente").eq("id", e.salida_id).maybeSingle() : { data: null };
  const alm = u.rol === "almacen" || u.rol === "supervisor_almacen";
  return (
    <div className="space-y-4">
      <Link href="/almacen/inventario" className="text-sm text-slate-500 hover:text-slate-800">← Inventario</Link>
      <PageHeader title={e.codigo} subtitle={<Chip cls={ESTADO_ETIQUETA[e.estado].cls}>{ESTADO_ETIQUETA[e.estado].label}</Chip>} />
      <Card className="space-y-3 p-4">
        <div>
          <p className="font-mono text-sm text-slate-500">{e.articulos?.clave}</p>
          <p className="text-lg font-semibold text-slate-900">{e.articulos?.nombre}</p>
        </div>
        <Dl
          items={[
            ["Recibido", fmtDay(e.recibida)],
            ["Recepción", e.recepciones ? `${e.recepciones.folio}${e.recepciones.orden_compra ? ` · OC ${e.recepciones.orden_compra}` : ""}` : ""],
            ["Proveedor", e.recepciones?.proveedor ?? ""],
            ["Lote", e.recepcion_lineas?.lote ?? ""],
            ["Salió", e.salida_at ? `${fmtDate(e.salida_at, cfg.timezone)}${sal ? ` · Factura ${sal.folio_factura}${sal.cliente ? ` · ${sal.cliente}` : ""}` : ""}` : ""],
            ["Baja", e.baja_at ? `${fmtDate(e.baja_at, cfg.timezone)} · ${e.baja_motivo ?? ""}` : ""],
          ]}
        />
        <div className="flex flex-wrap gap-3 text-sm">
          {e.recepciones && <Link href={`/almacen/recepciones/${e.recepciones.id}`} className="text-brand-700 underline">Ver recepción</Link>}
          {sal && <Link href={`/entregas/${sal.id}`} className="text-brand-700 underline">Ver entrega</Link>}
          {e.articulos && <Link href={`/almacen/inventario/${e.articulos.id}`} className="text-brand-700 underline">Existencias del artículo</Link>}
          <a href={`/imprimir/etiquetas?codigos=${e.codigo}`} target="_blank" rel="noreferrer" className="text-brand-700 underline">Reimprimir etiqueta</a>
        </div>
      </Card>
      {alm && e.estado === "almacen" && <BajaEtiqueta codigo={e.codigo} />}
    </div>
  );
}
