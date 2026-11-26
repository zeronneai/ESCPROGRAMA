import { FechasOc, entregaMasProxima } from "@/components/pegatron/fechas-oc";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LineasPegatron, type LineaPeg } from "@/components/pegatron/lineas";
import { TipoPegatron } from "@/components/pegatron/tipo-switch";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { signedUrl } from "@/lib/ops/server";
import { facturasPorOc, fechaCorta, importe } from "@/lib/pegatron-facturas";
import { createClient } from "@/lib/supabase/server";

export default async function OcPegatronPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRoles(["jefe_ventas", "comprador", "gerente", "ceo"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: o } = await supabase
    .from("pegatron_oc")
    .select("*, pegatron_oc_lineas(*)")
    .eq("id", id)
    .maybeSingle();
  if (!o) notFound();
  const lineas = ((o.pegatron_oc_lineas ?? []) as (LineaPeg & { posicion: number })[]).sort((a, b) => a.posicion - b.posicion);
  const pend = lineas.filter((l) => !l.pedido_at).length;
  const pdf = await signedUrl(supabase, "pegatron", o.archivo_path, null);
  const facts = (await facturasPorOc(supabase)).get(o.id) ?? [];
  return (
    <div className="space-y-4">
      <Link href={`/pedidos-pegatron?seccion=${o.tipo === "sobrepedido" ? "sobrepedido" : "linea"}`} className="text-sm text-slate-500 hover:text-brand-700">← Pedidos Pegatron</Link>
      <PageHeader
        title={`P/O ${o.po_numero}`}
        subtitle={`${o.folio} · Pegatron${o.moneda ? ` · ${o.moneda}` : ""}${o.autor_nombre ? ` · subió ${o.autor_nombre}` : ""}`}
        actions={pdf ? <a href={pdf} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Ver PDF de la orden</a> : null}
      />
      <TipoPegatron id={o.id} tipo={o.tipo === "sobrepedido" ? "sobrepedido" : "linea"} editable={u.rol === "jefe_ventas"} />
      <FechasOc grande subida={o.created_at} fechaOc={o.fecha} entrega={entregaMasProxima(lineas)} />
      <Card className={`flex flex-wrap items-center justify-between gap-2 p-4 ${pend ? "" : "border-green-300 bg-green-50"}`}>
        <span className="text-sm font-medium text-slate-800">{pend ? `${lineas.length - pend} de ${lineas.length} artículos pedidos` : "Todos los artículos ya se pidieron"}</span>
        {o.notas && <span className="text-sm text-slate-600">Notas: {o.notas}</span>}
      </Card>
      <Card className={`space-y-1 p-4 ${facts.length ? "border-indigo-300 bg-indigo-50" : ""}`}>
        <p className="text-sm font-semibold text-slate-800">{facts.length ? `Facturado (${facts.length} factura${facts.length === 1 ? "" : "s"})` : "Todavía no se factura"}</p>
        {facts.map((f) => (
          <p key={f.venta_id} className="text-sm text-slate-700">
            {f.factura ?? "Sin folio"} · {fechaCorta(f.fecha)} · {importe(f.subtotal, f.moneda)} sin IVA <span className="text-slate-500">({importe(f.total, f.moneda)} con IVA)</span>
          </p>
        ))}
        {!facts.length && <p className="text-xs text-slate-500">Cuando suban la factura con esta orden de compra (P/O {o.po_numero}), aquí sale el folio.</p>}
      </Card>
      <LineasPegatron lineas={lineas} rol={u.rol} />
    </div>
  );
}
